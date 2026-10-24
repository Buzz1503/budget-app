import Foundation
import AVFoundation
import SoundAnalysis
import CoreMotion
import HomeKit
import UIKit
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
/// Finished nights are written to the App Group for the web layer to collect.
final class SleepSoundsEngine: NSObject, SNResultsObserving, HMHomeManagerDelegate {
    static let shared = SleepSoundsEngine()

    private let engine = AVAudioEngine()
    private var analyzer: SNAudioStreamAnalyzer?
    private let analysisQueue = DispatchQueue(label: "pepito.sleepsounds.analysis")
    private let motion = CMMotionManager()
    private var homes: HMHomeManager?
    private var roomTimer: Timer?
    private var stopTimer: Timer?

    private(set) var startedAt: Date?
    private var startedBy = "app"
    private var detections: [SleepSoundsCore.Detection] = []
    private var levels: [(t: Double, db: Double)] = []
    private var moves: [(t: Double, g: Double)] = []
    private var room: [[Double]] = []
    private let lock = NSLock()

    var isRunning: Bool { startedAt != nil }

    private var directory: URL {
        let d = SharedStore.shared().directory.appendingPathComponent("sleep-sounds", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    // MARK: - start and stop

    @discardableResult
    func start(by: String = "app") -> Bool {
        if isRunning { return true }
        guard AVAudioApplication.shared.recordPermission == .granted || requestMic() else { return false }
        do {
            try configureSession()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            let analyzer = SNAudioStreamAnalyzer(format: format)
            let request = try SNClassifySoundRequest(classifierIdentifier: .version1)
            try analyzer.add(request, withObserver: self)
            self.analyzer = analyzer
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 8192, format: format) { [weak self] buffer, when in
                guard let self else { return }
                self.level(buffer)
                self.analysisQueue.async { analyzer.analyze(buffer, atAudioFramePosition: when.sampleTime) }
            }
            engine.prepare()
            try engine.start()
        } catch {
            stopAudio()
            return false
        }
        lock.lock(); detections = []; levels = []; moves = []; room = []; lock.unlock()
        startedAt = Date()
        startedBy = by
        startMotion()
        startRoom()
        UIDevice.current.isBatteryMonitoringEnabled = true
        stopTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in self?.checkStop() }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(interrupted), name: AVAudioSession.interruptionNotification, object: nil)
        UserDefaults.standard.set(Date(), forKey: "pepito.sleepsounds.lastStart")
        UserDefaults.standard.set(by, forKey: "pepito.sleepsounds.lastStartedBy")
        return true
    }

    func stop(reason: String? = nil) {
        guard let start = startedAt else { return }
        let end = Date()
        stopAudio()
        motion.stopDeviceMotionUpdates()
        roomTimer?.invalidate(); roomTimer = nil
        stopTimer?.invalidate(); stopTimer = nil
        NotificationCenter.default.removeObserver(self)
        startedAt = nil
        lock.lock()
        let dets = detections, lv = levels, mv = moves, rm = room
        lock.unlock()
        let minutes = SleepSoundsCore.minuteLevels(lv)
        let moving = SleepSoundsCore.movingMinutes(mv)
        let session = SleepSoundsSession(
            id: "ss-\(Int(start.timeIntervalSince1970))",
            start: start.timeIntervalSince1970 * 1000, end: end.timeIntervalSince1970 * 1000,
            events: SleepSoundsCore.events(dets), levels: minutes, loudMinutes: SleepSoundsCore.loudMinutes(minutes),
            movingMinutes: moving, lowConfidence: moving > SleepSoundsCore.movedALotMinutes, room: rm,
            startedBy: startedBy, stopReason: reason)
        if let data = try? JSONEncoder().encode(session) {
            try? data.write(to: directory.appendingPathComponent("\(session.id).json"), options: .atomic)
        }
        PepitoBridgePlugin.emit("sleepSoundsChanged", ["running": false])
    }

    private func stopAudio() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        analyzer?.removeAllRequests()
        analyzer = nil
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

    @objc private func routeChanged(_ note: Notification) {
        let current = AVAudioSession.sharedInstance().currentRoute.inputs.first?.portType.rawValue
        if SleepSoundsCore.needsReassert(currentInputType: current) { builtInMic() }
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended, isRunning else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        builtInMic()
        if !engine.isRunning { try? engine.start() }
    }

    // MARK: - level, classifier

    private func level(_ buffer: AVAudioPCMBuffer) {
        guard let ch = buffer.floatChannelData?[0] else { return }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += ch[i] * ch[i] }
        let db = SleepSoundsCore.dbfs(rms: Double((sum / Float(n)).squareRoot()))
        lock.lock(); levels.append((Date().timeIntervalSince1970, db)); lock.unlock()
    }

    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let r = result as? SNClassificationResult, let start = startedAt else { return }
        let t = start.timeIntervalSince1970 + r.timeRange.start.seconds
        var found: [SleepSoundsCore.Detection] = []
        for label in SleepSoundsCore.labels.keys {
            if let c = r.classification(forIdentifier: label), c.confidence >= SleepSoundsCore.minConfidence {
                found.append(.init(t: t, duration: r.timeRange.duration.seconds, label: label, confidence: c.confidence))
            }
        }
        guard !found.isEmpty else { return }
        lock.lock(); detections.append(contentsOf: found); lock.unlock()
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

    // MARK: - stopping on its own

    private func checkStop() {
        guard let start = startedAt else { return }
        let state = UIDevice.current.batteryState
        let plugged = state == .charging || state == .full
        if let reason = SleepSoundsCore.shouldStop(startedAt: start, now: Date(), pluggedIn: plugged) { stop(reason: reason.rawValue) }
    }

    // MARK: - for the web layer

    /// Finished nights not yet collected, oldest first.
    func finished() -> [[String: Any]] {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard let d = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
            return obj
        }
    }

    func acknowledge(_ ids: [String]) {
        for id in ids { try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json")) }
    }
}
