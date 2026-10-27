import Foundation
import AVFoundation
import SoundAnalysis
import CoreMotion
import HomeKit
import UIKit
import UserNotifications
import PepitoCore

/// Sleep sounds: snoring, coughing and sleep talking from Apple's built-in
/// on-device sound classifier, one noise level a minute, whether the phone
/// moved, and (with HomeKit) the bedroom temperature every 5 minutes.
///
/// Only timestamps, labels and confidence are kept. No audio is ever saved
/// or sent anywhere. The session shares the microphone without touching
/// whatever else is playing: playAndRecord, mixing with others, A2DP only,
/// and the iPhone's own microphone as the input (re-set when AirPods come
/// and go), so AirPods stay in their high-quality playback mode.
///
/// Runs in the background on the audio background mode. Started from the app,
/// the "Start sleep sounds" shortcut (a Sleep Focus automation), and stopped
/// by "Stop sleep sounds", by unplugging after 4 am, or after 11 hours.
///
/// The session file in the App Group is written the moment listening starts and
/// rewritten every 5 minutes (a checkpoint), so an app that is closed overnight
/// still leaves the night up to its last checkpoint. The next launch closes such a
/// file as "app closed". A call, Siri, an alarm, AirPods switching or another app
/// taking the microphone is recorded as a gap and listening resumes.
final class SleepSoundsEngine: NSObject, HMHomeManagerDelegate {
    static let shared = SleepSoundsEngine()

    private let engine = AVAudioEngine()
    private var segment: Segment?
    private let analysisQueue = DispatchQueue(label: "pepito.sleepsounds.analysis")
    private let motion = CMMotionManager()
    private var homes: HMHomeManager?
    private var roomTimer: Timer?
    private var tickTimer: Timer?
    private var testTimer: Timer?
    private var testDone: (([String: Any]) -> Void)?

    private(set) var startedAt: Date?
    private var sessionId: String?
    private var startedBy = "app"
    private var detections: [SleepSoundsCore.Detection] = []
    private var levels: [(t: Double, db: Double)] = []
    private var moves: [(t: Double, g: Double)] = []
    private var room: [[Double]] = []
    private var gaps: [SleepSoundsCore.Gap] = []
    private var gapStart: (at: Date, reason: String)?
    private var checkpoints = 0
    private var lastCheckpoint = Date()
    private var pausedNoticeSent = false
    private let lock = NSLock()

    var isRunning: Bool { startedAt != nil }
    var hasOpenGap: Bool { gapStart != nil }
    var lastCheckpointMs: Double? { startedAt == nil ? nil : lastCheckpoint.timeIntervalSince1970 * 1000 }

    private var directory: URL {
        let d = SharedStore.shared().directory.appendingPathComponent("sleep-sounds", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

    // MARK: - start and stop

    /// Starts listening and reports exactly what happened. Every attempt goes in the start log
    /// (with the iOS error text); an automatic start that fails sends a notification to start it by hand.
    @discardableResult
    func startWithResult(by: String = "app") -> SleepSoundsCore.LogEntry {
        let now = ms(Date())
        if isRunning { return .init(at: now, kind: "start", by: by, result: SleepSoundsCore.StartResult.alreadyRunning.rawValue) }
        let granted = AVAudioApplication.shared.recordPermission == .granted
        var entry: SleepSoundsCore.LogEntry
        if !granted {
            if by != "test" { AVAudioApplication.requestRecordPermission { _ in } }
            entry = .init(at: now, kind: "start", by: by, result: SleepSoundsCore.StartResult.noPermission.rawValue)
        } else {
            lock.lock(); detections = []; levels = []; moves = []; room = []; lock.unlock()
            gaps = []; gapStart = nil; checkpoints = 0; pausedNoticeSent = false
            do {
                try startAudio()
                entry = .init(at: now, kind: "start", by: by, result: SleepSoundsCore.StartResult.started.rawValue)
            } catch {
                stopAudio()
                let ns = error as NSError
                let result = SleepSoundsCore.classifyStart(
                    permission: true, errorCode: ns.code,
                    locked: !UIApplication.shared.isProtectedDataAvailable,
                    appActive: UIApplication.shared.applicationState == .active)
                entry = .init(at: now, kind: "start", by: by, result: result.rawValue, error: "\(ns.localizedDescription) (\(ns.domain) \(ns.code))")
            }
        }
        if by != "test" { record(entry) }
        guard entry.result == SleepSoundsCore.StartResult.started.rawValue else {
            if by != "app", by != "test", let r = SleepSoundsCore.StartResult(rawValue: entry.result) {
                SleepSoundsNotices.post(id: "pepito.sounds.startfailed", body: SleepSoundsCore.startFailedNotice(r))
            }
            return entry
        }
        let began = Date()
        startedAt = began
        startedBy = by
        sessionId = "ss-\(Int(began.timeIntervalSince1970))"
        lastCheckpoint = began
        startMotion()
        startRoom()
        UIDevice.current.isBatteryMonitoringEnabled = true
        tickTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.tick() }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(configChanged), name: .AVAudioEngineConfigurationChange, object: engine)
        nc.addObserver(self, selector: #selector(terminating), name: UIApplication.willTerminateNotification, object: nil)
        if by != "test" {
            UserDefaults.standard.set(began, forKey: "pepito.sleepsounds.lastStart")
            UserDefaults.standard.set(by, forKey: "pepito.sleepsounds.lastStartedBy")
            // listening: tonight's "not listening yet" check is not needed, and a failed-start notice is stale
            SleepSoundsNotices.listeningStarted(at: began)
            // the record exists from the first second, so a kill at any point leaves something
            writeSession(open: true, reason: nil)
        }
        return entry
    }

    @discardableResult
    func start(by: String = "app") -> Bool {
        let r = startWithResult(by: by).result
        return r == SleepSoundsCore.StartResult.started.rawValue || r == SleepSoundsCore.StartResult.alreadyRunning.rawValue
    }

    // MARK: - the start log

    private var logURL: URL { SharedStore.shared().directory.appendingPathComponent("sleep-sounds-start-log.json") }

    func startLog() -> [SleepSoundsCore.LogEntry] {
        guard let d = try? Data(contentsOf: logURL) else { return [] }
        return (try? JSONDecoder().decode([SleepSoundsCore.LogEntry].self, from: d)) ?? []
    }

    func record(_ entry: SleepSoundsCore.LogEntry) {
        let next = SleepSoundsCore.appended(startLog(), entry)
        if let data = try? JSONEncoder().encode(next) { try? data.write(to: logURL, options: .atomic) }
    }

    /// A tap on a "start it" notification asks the web layer to start in the foreground.
    var pendingStart: Bool {
        get { UserDefaults.standard.bool(forKey: "pepito.sleepsounds.pendingStart") }
        set { UserDefaults.standard.set(newValue, forKey: "pepito.sleepsounds.pendingStart") }
    }

    /// Words for the Stop automation when nothing is running.
    func notRunningWords() -> String {
        recoverOpenSessions()
        let last = startLog().last { $0.kind == "start" }
        var end: (ms: Double, reason: String?)?
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.pathExtension == "json" {
            guard let d = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(SleepSoundsSession.self, from: d), !s.open else { continue }
            if end == nil || s.end > end!.ms { end = (s.end, s.stopReason) }
        }
        return SleepSoundsCore.notRunningWords(lastStart: last, lastEnd: end, nowMs: ms(Date()))
    }

    func stop(reason: String? = nil) {
        guard startedAt != nil else { return }
        if gapStart != nil { endGap() }
        let wasTest = startedBy == "test"
        // the finished record is written while the session still exists
        if !wasTest { writeSession(open: false, reason: reason) }
        if !wasTest, SleepSoundsCore.isUnexpected(reason) {
            // at the moment it stops, with when and why, not at wake-up
            SleepSoundsNotices.post(id: "pepito.sounds.stopped", body: SleepSoundsCore.stoppedNotice(reason: reason, atMs: ms(Date())))
        }
        let summary = wasTest ? testSummary() : nil
        stopAudio()
        motion.stopDeviceMotionUpdates()
        roomTimer?.invalidate(); roomTimer = nil
        tickTimer?.invalidate(); tickTimer = nil
        testTimer?.invalidate(); testTimer = nil
        NotificationCenter.default.removeObserver(self)
        startedAt = nil
        sessionId = nil
        if let done = testDone, let summary { testDone = nil; done(summary) }
        PepitoBridgePlugin.emit("sleepSoundsChanged", ["running": false])
    }

    /// Everything the session knows, to disk. `open` while listening, closed once it has stopped.
    private func writeSession(open: Bool, reason: String?) {
        guard let start = startedAt, let id = sessionId, startedBy != "test" else { return }
        let now = Date()
        var g = gaps
        if let current = gapStart { g.append(.init(s: ms(current.at), e: ms(now), reason: current.reason)) }
        lock.lock()
        let dets = detections, lv = levels, mv = moves, rm = room
        lock.unlock()
        if open { checkpoints += 1 }
        let session = SleepSoundsCore.session(
            id: id, start: ms(start), now: ms(now), detections: dets, levels: lv, moves: mv, room: rm,
            startedBy: startedBy, gaps: g, checkpoints: checkpoints, open: open, stopReason: reason)
        if let data = try? JSONEncoder().encode(session) {
            try? data.write(to: directory.appendingPathComponent("\(session.id).json"), options: .atomic)
        }
        lastCheckpoint = now
    }

    /// The "Test for 1 minute" result: what was heard and how loud the room was. Nothing is stored.
    private func testSummary() -> [String: Any] {
        lock.lock()
        let dets = detections, lv = levels
        lock.unlock()
        let events = SleepSoundsCore.events(dets)
        let heard: [[String: Any]] = Dictionary(grouping: events, by: \.label).map { label, list in
            ["label": label, "count": list.count, "seconds": Int(list.reduce(0) { $0 + ($1.e - $1.s) } / 1000)]
        }.sorted { ($0["label"] as? String ?? "") < ($1["label"] as? String ?? "") }
        let dbs = lv.map(\.db)
        return [
            "ran": true,
            "seconds": Int(SleepSoundsCore.testSeconds),
            "heard": heard,
            "avgDb": dbs.isEmpty ? (NSNull() as Any) : ((dbs.reduce(0, +) / Double(dbs.count)).rounded() as Any),
            "maxDb": (dbs.max().map { $0.rounded() as Any }) ?? (NSNull() as Any)
        ]
    }

    /// Listen for one minute, keep nothing, and say what was heard.
    func runTest(_ done: @escaping ([String: Any]) -> Void) {
        guard !isRunning else { done(["ran": false, "reason": "running"]); return }
        guard AVAudioApplication.shared.recordPermission == .granted else { done(["ran": false, "reason": "microphone"]); return }
        guard start(by: "test") else { done(["ran": false, "reason": "unavailable"]); return }
        testDone = done
        testTimer = Timer.scheduledTimer(withTimeInterval: SleepSoundsCore.testSeconds, repeats: false) { [weak self] _ in self?.stop(reason: "test") }
    }

    // MARK: - audio engine

    /// One run of the audio engine, with its own analyzer and its own clock.
    fileprivate final class Segment: NSObject, SNResultsObserving {
        let analyzer: SNAudioStreamAnalyzer
        private let lock = NSLock()
        private var clock: SleepSoundsCore.SegmentClock?
        private let onFound: ([SleepSoundsCore.Detection]) -> Void

        init(format: AVAudioFormat, onFound: @escaping ([SleepSoundsCore.Detection]) -> Void) throws {
            analyzer = SNAudioStreamAnalyzer(format: format)
            self.onFound = onFound
            super.init()
            let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
            try analyzer.add(request, withObserver: self)
        }

        /// The first buffer fixes how audio time maps to the clock for this segment.
        func anchorIfNeeded(sampleTime: AVAudioFramePosition, frames: AVAudioFrameCount, rate: Double) {
            lock.lock(); defer { lock.unlock() }
            guard clock == nil, rate > 0 else { return }
            clock = .init(baseWall: Date().timeIntervalSince1970 - Double(frames) / rate, baseSeconds: Double(sampleTime) / rate)
        }

        func request(_ request: SNRequest, didProduce result: SNResult) {
            guard let r = result as? SNClassificationResult else { return }
            lock.lock(); let c = clock; lock.unlock()
            guard let c else { return }
            let t = c.wall(r.timeRange.start.seconds)
            var found: [SleepSoundsCore.Detection] = []
            for label in SleepSoundsCore.labels.keys {
                if let hit = r.classification(forIdentifier: label), hit.confidence >= SleepSoundsCore.minConfidence {
                    found.append(.init(t: t, duration: r.timeRange.duration.seconds, label: label, confidence: hit.confidence))
                }
            }
            if !found.isEmpty { onFound(found) }
        }
    }

    private func startAudio() throws {
        try configureSession()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "pepito.sleepsounds", code: 1, userInfo: [NSLocalizedDescriptionKey: "no input"])
        }
        let seg = try Segment(format: format) { [weak self] found in
            guard let self else { return }
            self.lock.lock(); self.detections.append(contentsOf: found); self.lock.unlock()
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self, weak seg] buffer, when in
            guard let self, let seg else { return }
            seg.anchorIfNeeded(sampleTime: when.sampleTime, frames: buffer.frameLength, rate: format.sampleRate)
            self.level(buffer)
            self.analysisQueue.async { seg.analyzer.analyze(buffer, atAudioFramePosition: when.sampleTime) }
        }
        engine.prepare()
        try engine.start()
        segment = seg
    }

    /// Stops listening but keeps the audio session, for a resume that follows.
    private func pauseEngine() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        segment?.analyzer.removeAllRequests()
        segment = nil
    }

    private func stopAudio() {
        pauseEngine()
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func requestMic() -> Bool {
        AVAudioApplication.requestRecordPermission { _ in }
        return false
    }

    // MARK: - the audio session: never interrupt or degrade other audio

    private func configureSession() throws {
        let s = AVAudioSession.sharedInstance()
        var opts: AVAudioSession.CategoryOptions = []
        for o in SleepSoundsCore.options {
            switch o {
            case .mixWithOthers: opts.insert(.mixWithOthers)
            case .allowBluetoothA2DP: opts.insert(.allowBluetoothA2DP)
            case .allowBluetooth: opts.insert(.allowBluetooth)
            case .defaultToSpeaker: opts.insert(.defaultToSpeaker)
            case .duckOthers: opts.insert(.duckOthers)
            }
        }
        try s.setCategory(.playAndRecord, mode: .default, options: opts)
        try s.setActive(true)
        builtInMic()
    }

    /// The iPhone's own microphone, never the AirPods'.
    private func builtInMic() {
        let s = AVAudioSession.sharedInstance()
        let ports = (s.availableInputs ?? []).map { (type: $0.portType.rawValue, uid: $0.uid) }
        guard let uid = SleepSoundsCore.preferredInput(ports), let port = s.availableInputs?.first(where: { $0.uid == uid }) else { return }
        try? s.setPreferredInput(port)
    }

    // MARK: - interruptions: a gap, then back to listening

    private func beginGap(_ reason: String) {
        guard isRunning, gapStart == nil else { return }
        gapStart = (Date(), reason)
        writeSession(open: true, reason: nil)
    }

    private func endGap() {
        guard let g = gapStart else { return }
        gaps.append(.init(s: ms(g.at), e: ms(Date()), reason: g.reason))
        gapStart = nil
        if pausedNoticeSent { pausedNoticeSent = false; SleepSoundsNotices.remove(ids: ["pepito.sounds.paused"]) }
    }

    /// Tries to listen again; if the microphone is still taken the gap stays open and the next minute tries again.
    private func resume() {
        guard isRunning else { return }
        pauseEngine()
        do {
            try startAudio()
            endGap()
            writeSession(open: true, reason: nil)
        } catch {
            // still busy: tick() tries again
        }
    }

    @objc private func routeChanged(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isRunning else { return }
            let current = AVAudioSession.sharedInstance().currentRoute.inputs.first?.portType.rawValue
            if SleepSoundsCore.needsReassert(currentInputType: current) { self.builtInMic() }
            if !self.engine.isRunning { self.beginGap("route"); self.resume() }
        }
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isRunning else { return }
            switch type {
            case .began: self.beginGap("interrupted")
            case .ended: self.resume()
            @unknown default: break
            }
        }
    }

    @objc private func configChanged(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isRunning else { return }
            self.beginGap("route")
            self.resume()
        }
    }

    /// iOS is closing the app: end the session cleanly rather than leave it open.
    @objc private func terminating(_ note: Notification) {
        stop(reason: SleepSoundsCore.StopReason.appClosed.rawValue)
    }

    // MARK: - level

    private func level(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let db = SleepSoundsCore.dbfs(rms: Double((sum / Float(n)).squareRoot()))
        lock.lock(); levels.append((Date().timeIntervalSince1970, db)); lock.unlock()
    }

    // MARK: - the phone moving

    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1
        motion.startDeviceMotionUpdates(to: OperationQueue()) { [weak self] m, _ in
            guard let self, let a = m?.userAcceleration else { return }
            let g = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            self.lock.lock(); self.moves.append((Date().timeIntervalSince1970, g)); self.lock.unlock()
        }
    }

    // MARK: - bedroom temperature (HomeKit, optional)

    private func startRoom() {
        guard NativeFeatures.homeKit else { return }
        if homes == nil { homes = HMHomeManager(); homes?.delegate = self }
        roomTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.readRoom() }
        readRoom()
    }

    /// A temperature sensor in a room with "bed" in its name, else the first one found.
    private func sensor() -> (temp: HMCharacteristic, humidity: HMCharacteristic?)? {
        let services = (homes?.homes ?? []).flatMap(\.accessories).flatMap(\.services)
        let temps = services.filter { $0.serviceType == HMServiceTypeTemperatureSensor }
        let pick = temps.first { ($0.accessory?.room?.name ?? "").localizedCaseInsensitiveContains("bed") } ?? temps.first
        guard let svc = pick, let t = svc.characteristics.first(where: { $0.characteristicType == HMCharacteristicTypeCurrentTemperature }) else { return nil }
        let hum = svc.accessory?.services.first { $0.serviceType == HMServiceTypeHumiditySensor }?
            .characteristics.first { $0.characteristicType == HMCharacteristicTypeCurrentRelativeHumidity }
        return (t, hum)
    }

    private func readRoom() {
        guard let s = sensor() else { return }
        s.temp.readValue { [weak self] _ in
            guard let self, let temp = (s.temp.value as? NSNumber)?.doubleValue else { return }
            let finish = { (h: Double) in
                self.lock.lock(); self.room.append([Date().timeIntervalSince1970 * 1000, temp, h]); self.lock.unlock()
            }
            if let h = s.humidity { h.readValue { _ in finish((h.value as? NSNumber)?.doubleValue ?? -1) } } else { finish(-1) }
        }
    }

    /// Whether HomeKit has a temperature sensor this app can read.
    var hasRoomSensor: Bool { NativeFeatures.homeKit && sensor() != nil }

    func prepareHomeKit() {
        guard NativeFeatures.homeKit, homes == nil else { return }
        homes = HMHomeManager()
        homes?.delegate = self
    }

    // MARK: - every minute: stop rules, resume, checkpoint

    private func tick() {
        guard let start = startedAt else { return }
        let state = UIDevice.current.batteryState
        let plugged = state == .charging || state == .full
        if let reason = SleepSoundsCore.shouldStop(startedAt: start, now: Date(), pluggedIn: plugged) { stop(reason: reason.rawValue); return }
        if startedBy == "test" { return }
        // the engine stopped without telling us: that is a gap too
        if !engine.isRunning { beginGap(gapStart?.reason ?? "interrupted") }
        if gapStart != nil { resume() }
        // still paused after an hour: give up, and say when and why it stopped
        if let g = gapStart, Date().timeIntervalSince(g.at) >= 3600 { stop(reason: SleepSoundsCore.StopReason.interrupted.rawValue); return }
        // paused for 5 minutes and not back: say so now, once per pause
        if let g = gapStart, !pausedNoticeSent, Date().timeIntervalSince(g.at) >= 300 {
            pausedNoticeSent = true
            SleepSoundsNotices.post(id: "pepito.sounds.paused", body: SleepSoundsCore.pausedNotice(sinceMs: ms(g.at)))
        }
        if Date().timeIntervalSince(lastCheckpoint) >= SleepSoundsCore.checkpointEverySec { writeSession(open: true, reason: nil) }
    }

    // MARK: - for the web layer

    /// A session still marked open that this launch is not running was cut short (the app was
    /// closed, or iOS ended it): close it at its last checkpoint and say so.
    func recoverOpenSessions() {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.pathExtension == "json" {
            guard let d = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(SleepSoundsSession.self, from: d),
                  s.open, s.id != sessionId else { continue }
            let closed = SleepSoundsCore.recover(s)
            if let data = try? JSONEncoder().encode(closed) { try? data.write(to: url, options: .atomic) }
            // found on this launch: say when it stopped and why, unless it is old news
            if ms(Date()) - closed.end < 14 * 3600_000 {
                SleepSoundsNotices.post(id: "pepito.sounds.stopped.\(closed.id)", body: SleepSoundsCore.stoppedNotice(reason: closed.stopReason, atMs: closed.end))
            }
        }
    }

    /// Finished nights not yet collected, oldest first. A session still listening is not one of them.
    func finished() -> [[String: Any]] {
        recoverOpenSessions()
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard let d = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
            if (obj["open"] as? Bool) == true { return nil }
            return obj
        }
    }

    func acknowledge(_ ids: [String]) {
        for id in ids { try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json")) }
    }
}

/// The notifications Sleep sounds sends itself: it could not start, it stopped (when and why), it paused,
/// and the bedtime check. Tapping any of them opens the app and starts listening in the foreground.
enum SleepSoundsNotices {
    static func post(id: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = "Sleep sounds"
        c.body = body
        c.sound = .default
        c.userInfo = ["pepito.sounds": "start"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    static func remove(ids: [String]) {
        let n = UNUserNotificationCenter.current()
        n.removePendingNotificationRequests(withIdentifiers: ids)
        n.removeDeliveredNotifications(withIdentifiers: ids)
    }

    /// Tonight's bedtime check is cleared and any failed-start notice taken down.
    static func listeningStarted(at: Date) {
        let n = UNUserNotificationCenter.current()
        remove(ids: ["pepito.sounds.startfailed", "pepito.sounds.stopped", "pepito.sounds.paused"])
        n.getPendingNotificationRequests { reqs in
            let pending: [(id: String, fire: Date)] = reqs.compactMap { r in
                guard let t = r.trigger as? UNCalendarNotificationTrigger, let d = t.nextTriggerDate() else { return nil }
                return (r.identifier, d)
            }
            remove(ids: SleepSoundsCore.checksToCancel(pending, startedAt: at))
        }
    }

    /// One check a night for the next 7 nights, 10 minutes after bedtime. `nil` clears them.
    static func scheduleChecks(bedtime: String?) {
        let n = UNUserNotificationCenter.current()
        n.getPendingNotificationRequests { reqs in
            n.removePendingNotificationRequests(withIdentifiers: reqs.map(\.identifier).filter { $0.hasPrefix(SleepSoundsCore.checkPrefix) })
            guard let bedtime else { return }
            for t in SleepSoundsCore.checkTimes(bedtime: bedtime, now: Date()) {
                let c = UNMutableNotificationContent()
                c.title = "Sleep sounds"
                c.body = SleepSoundsCore.bedtimeNotice
                c.sound = .default
                c.userInfo = ["pepito.sounds": "start"]
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: t.fire)
                n.add(UNNotificationRequest(identifier: t.id, content: c, trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
            }
        }
    }
}
