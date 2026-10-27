import Foundation

/// Sleep sounds on the iPhone: the rules, kept apart from AVFoundation so
/// they can be tested anywhere. The app target turns these into an audio
/// session, a sound classifier and a few sensors (SleepSounds.swift).
///
/// Only timestamps, labels and confidence are kept, and one level a minute.
/// No audio is ever saved.
public enum SleepSoundsCore {
    // MARK: audio session

    /// The audio session options, by name. Mixing with others keeps YouTube
    /// (or anything else) playing untouched; A2DP keeps AirPods in their
    /// high-quality playback mode. Plain Bluetooth (HFP) is never allowed,
    /// because it would switch the AirPods to their call microphone and
    /// lower the playback quality.
    public enum Option: String, CaseIterable, Sendable { case mixWithOthers, allowBluetoothA2DP, allowBluetooth, defaultToSpeaker, duckOthers }
    public static let category = "playAndRecord"
    public static let options: Set<Option> = [.mixWithOthers, .allowBluetoothA2DP]

    /// The input to use: always the iPhone's own microphone, never a headset's.
    public static func preferredInput(_ ports: [(type: String, uid: String)]) -> String? {
        ports.first { $0.type == "MicrophoneBuiltIn" }?.uid
    }

    /// After a route change (AirPods in or out), whether the input has to be set again.
    public static func needsReassert(currentInputType: String?) -> Bool { currentInputType != "MicrophoneBuiltIn" }

    // MARK: classifier

    /// The built-in classifier's labels kept, and the confidence a window needs.
    public static let labels: [String: String] = ["snoring": "snoring", "cough": "cough", "speech": "speech"]
    public static let minConfidence = 0.5
    /// Windows of the same label closer than this are one event.
    public static let mergeGapSec = 3.0

    public struct Detection: Equatable, Sendable {
        public var t: Double        // epoch seconds, window start
        public var duration: Double // seconds
        public var label: String
        public var confidence: Double
        public init(t: Double, duration: Double, label: String, confidence: Double) {
            self.t = t; self.duration = duration; self.label = label; self.confidence = confidence
        }
    }

    public struct Event: Codable, Equatable, Sendable {
        public var s: Double   // start, epoch ms
        public var e: Double   // end, epoch ms
        public var label: String
        public var c: Double   // highest confidence in it
        public init(s: Double, e: Double, label: String, c: Double) { self.s = s; self.e = e; self.label = label; self.c = c }
    }

    /// Classifier windows above the confidence bar, joined into events per label.
    public static func events(_ detections: [Detection]) -> [Event] {
        var out: [Event] = []
        let byLabel = Dictionary(grouping: detections.filter { $0.confidence >= minConfidence && labels[$0.label] != nil }, by: \.label)
        for (label, list) in byLabel {
            var cur: Event?
            for d in list.sorted(by: { $0.t < $1.t }) {
                let s = d.t * 1000, e = (d.t + d.duration) * 1000
                if var c = cur, s - c.e <= mergeGapSec * 1000 {
                    c.e = max(c.e, e); c.c = max(c.c, d.confidence); cur = c
                } else {
                    if let c = cur { out.append(c) }
                    cur = Event(s: s, e: e, label: labels[label]!, c: d.confidence)
                }
            }
            if let c = cur { out.append(c) }
        }
        return out.sorted { $0.s < $1.s }
    }

    // MARK: levels

    /// Level of a buffer in dB relative to full scale, from its RMS.
    public static func dbfs(rms: Double) -> Double { rms > 0 ? max(-120, 20 * log10(rms)) : -120 }

    /// One level a minute: the mean of the buffers' levels in that minute (dB, rounded).
    public static func minuteLevels(_ samples: [(t: Double, db: Double)]) -> [[Double]] {
        let byMin = Dictionary(grouping: samples, by: { ($0.t / 60).rounded(.down) })
        return byMin.keys.sorted().map { m in
            let v = byMin[m]!.map(\.db)
            return [m * 60_000, (v.reduce(0, +) / Double(v.count)).rounded()]
        }
    }

    /// Loud moments: minutes 15 dB or more above the night's median level.
    public static func loudMinutes(_ levels: [[Double]]) -> Int {
        let v = levels.map { $0[1] }.sorted()
        guard !v.isEmpty else { return 0 }
        let median = v[v.count / 2]
        return v.filter { $0 >= median + 15 }.count
    }

    // MARK: stopping on its own

    /// Why a session ended. The first three come from `shouldStop`; `app` is a hand stop,
    /// `interrupted` an interruption that never ended, `appClosed` a session found open
    /// on the next launch (iOS or the user closed the app, or it crashed).
    public enum StopReason: String, Sendable { case focusOff, unplugged, tooLong, app, interrupted, appClosed, scheduled }
    public static let maxHours = 11.0

    /// Whether a running session should stop: unplugged after 4 am, or past 11 hours.
    /// (Sleep Focus turning off arrives as the Stop sleep sounds shortcut.)
    public static func shouldStop(startedAt: Date, now: Date, pluggedIn: Bool, calendar: Calendar = .current) -> StopReason? {
        if now.timeIntervalSince(startedAt) >= maxHours * 3600 { return .tooLong }
        let h = calendar.component(.hour, from: now)
        if !pluggedIn, h >= 4, h < 12, now.timeIntervalSince(startedAt) > 3600 { return .unplugged }
        return nil
    }

    /// "When iPhone connects to power after 8 pm": the shortcut's evening-only
    /// option starts it from 8 pm to 4 am and does nothing at other times.
    public static func inEveningWindow(_ now: Date, calendar: Calendar = .current) -> Bool {
        let h = calendar.component(.hour, from: now)
        return h >= 20 || h < 4
    }

    // MARK: keeping the session while it runs

    /// The session file is written when listening starts and again this often,
    /// so a closed app leaves everything up to the last checkpoint.
    public static let checkpointEverySec = 300.0
    /// A test run for the "Test for 1 minute" button.
    public static let testSeconds = 60.0

    /// A stretch of the night with no audio captured: a call, Siri, an alarm,
    /// AirPods switching, another app taking the microphone.
    public struct Gap: Codable, Equatable, Sendable {
        public var s: Double   // start, epoch ms
        public var e: Double   // end, epoch ms
        public var reason: String
        public init(s: Double, e: Double, reason: String) { self.s = s; self.e = e; self.reason = reason }
    }

    /// Maps the analyzer's audio time to the clock. Each engine start (the first and every
    /// resume after an interruption) is its own segment, because the audio timeline restarts.
    public struct SegmentClock: Equatable, Sendable {
        public var baseWall: Double     // epoch seconds when the segment's first buffer began
        public var baseSeconds: Double  // the analyzer's time for that buffer
        public init(baseWall: Double, baseSeconds: Double) { self.baseWall = baseWall; self.baseSeconds = baseSeconds }
        public func wall(_ seconds: Double) -> Double { baseWall + (seconds - baseSeconds) }
    }

    /// The session as it stands: everything heard so far, whether it is still open or finished.
    public static func session(id: String, start: Double, now: Double, detections: [Detection], levels: [(t: Double, db: Double)],
                               moves: [(t: Double, g: Double)], room: [[Double]], startedBy: String, gaps: [Gap],
                               checkpoints: Int, open: Bool, stopReason: String?) -> SleepSoundsSession {
        let minutes = minuteLevels(levels)
        let moving = movingMinutes(moves)
        return SleepSoundsSession(
            id: id, start: start, end: now, events: events(detections), levels: minutes, loudMinutes: loudMinutes(minutes),
            movingMinutes: moving, lowConfidence: moving > movedALotMinutes, room: room, startedBy: startedBy, stopReason: stopReason,
            open: open, lastCheckpoint: now, gaps: gaps, checkpoints: checkpoints, recovered: false)
    }

    /// A session found still open on a later launch: it ends at its last checkpoint, with
    /// any gap that was running closed there, and says why.
    public static func recover(_ s: SleepSoundsSession) -> SleepSoundsSession {
        guard s.open else { return s }
        var out = s
        out.end = max(s.lastCheckpoint, s.start)
        out.open = false
        out.recovered = true
        out.stopReason = s.stopReason ?? StopReason.appClosed.rawValue
        out.events = s.events.filter { $0.s < out.end }.map { var e = $0; e.e = min(e.e, out.end); return e }
        out.gaps = s.gaps.map { var g = $0; g.e = min(max(g.e, g.s), out.end); return g }
        return out
    }

    // MARK: starting, and saying what happened

    /// What a start attempt came to. Logged every time, with the iOS error text when there was one.
    public enum StartResult: String, Codable, Sendable {
        case started, alreadyRunning, noPermission
        /// the phone was locked, so iOS would not let the microphone start
        case blockedLocked
        /// the app was not in the foreground, and iOS would not let the microphone start
        case blockedBackground
        case audioError
    }

    /// AVAudioSession error codes iOS returns when recording may not start from here.
    public static let blockedCodes: Set<Int> = [561_145_187 /* cannotStartRecording */, 561_017_449 /* insufficientPriority */, 560_557_684 /* cannotInterruptOthers */]

    public static func classifyStart(permission: Bool, errorCode: Int?, locked: Bool, appActive: Bool) -> StartResult {
        if !permission { return .noPermission }
        guard let code = errorCode else { return .started }
        if locked { return .blockedLocked }
        if blockedCodes.contains(code) || !appActive { return .blockedBackground }
        return .audioError
    }

    /// One line in the start log: a start or a stop attempt.
    public struct LogEntry: Codable, Equatable, Sendable {
        public var at: Double        // epoch ms
        public var kind: String      // "start" or "stop"
        public var by: String        // app, shortcut, notification, test
        public var result: String    // a StartResult raw value, or "notRunning" for a stop with nothing to stop
        public var error: String?
        public init(at: Double, kind: String, by: String, result: String, error: String? = nil) {
            self.at = at; self.kind = kind; self.by = by; self.result = result; self.error = error
        }
    }

    public static let logKeep = 60
    /// The newest `keep` entries, oldest first.
    public static func appended(_ log: [LogEntry], _ entry: LogEntry, keep: Int = logKeep) -> [LogEntry] {
        Array((log + [entry]).suffix(keep))
    }

    /// "3:12 am".
    public static func timeWords(_ ms: Double, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: ms / 1000))
        let h = c.hour ?? 0, m = c.minute ?? 0
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12):\(m < 10 ? "0" : "")\(m) \(h < 12 ? "am" : "pm")"
    }

    /// Why a start did not happen, in plain words.
    public static func startFailureWords(_ r: StartResult) -> String {
        switch r {
        case .started, .alreadyRunning: return ""
        case .noPermission: return "Microphone access is off. Allow it in Settings."
        case .blockedLocked: return "The phone was locked, so iOS did not allow the microphone to start."
        case .blockedBackground: return "The app was in the background, so iOS did not allow the microphone to start."
        case .audioError: return "The audio session could not start."
        }
    }

    /// Why a session ended, as a short clause.
    public static func stopReasonWords(_ reason: String?) -> String {
        switch reason {
        case StopReason.interrupted.rawValue: return "Another app or a call kept the microphone."
        case StopReason.appClosed.rawValue: return "The app was closed."
        case StopReason.unplugged.rawValue: return "The phone was unplugged."
        case StopReason.tooLong.rawValue: return "It reached the 11 hour limit."
        case StopReason.focusOff.rawValue: return "Sleep Focus ended."
        case StopReason.scheduled.rawValue: return "The schedule ended."
        default: return "It was stopped."
        }
    }

    /// A stop nobody asked for: worth a notification the moment it happens.
    public static func isUnexpected(_ reason: String?) -> Bool {
        reason == StopReason.interrupted.rawValue || reason == StopReason.appClosed.rawValue
    }

    /// The notification sent when capture stops on its own: when, and why.
    public static func stoppedNotice(reason: String?, atMs: Double, calendar: Calendar = .current) -> String {
        "Sleep sounds stopped recording at \(timeWords(atMs, calendar: calendar)). \(stopReasonWords(reason)) Tap to start it again."
    }

    /// Sent when listening has been paused for a while and has not come back.
    public static func pausedNotice(sinceMs: Double, calendar: Calendar = .current) -> String {
        "Sleep sounds paused at \(timeWords(sinceMs, calendar: calendar)). Another app or a call has the microphone. It listens again as soon as it can."
    }

    /// Sent when an automatic start could not begin capture.
    public static func startFailedNotice(_ r: StartResult) -> String { "Sleep sounds could not start. \(startFailureWords(r)) Tap to start it." }

    /// The bedtime safety net: nothing is listening yet.
    public static let bedtimeNotice = "Sleep sounds is not listening yet. Tap to start it."
    /// The scheduled start could not begin capture by itself.
    public static let scheduleFallbackNotice = "Tap to start Sleep sounds."

    /// What the scheduled start does: nothing when already listening (started by hand or by Sleep Focus).
    public static func shouldStartOnSchedule(isRunning: Bool) -> Bool { !isRunning }

    /// The app's own stop at the scheduled time, the backup to the stop automation.
    public static func reachedScheduledStop(now: Date, until: Date?) -> Bool { until.map { now >= $0 } ?? false }

    /// The notification after a start that did not begin capture: none for a start in the app (the
    /// screen shows the result) or a test; time sensitive, so it shows through a Sleep Focus.
    public static func startFailedFallback(by: String, result: StartResult) -> (body: String, timeSensitive: Bool)? {
        guard by != "app", by != "test", result != .started, result != .alreadyRunning else { return nil }
        let body = by == "schedule" ? "\(scheduleFallbackNotice) \(startFailureWords(result))" : startFailedNotice(result)
        return (body, true)
    }

    /// A time-limited session's end: the schedule's stop, never past the 11 hour limit.
    public static func until(startedAt: Date, schedule: SleepSoundsSchedule?, calendar: Calendar = .current) -> Date {
        let cap = startedAt.addingTimeInterval(maxHours * 3600)
        guard let s = schedule, s.on, let stop = s.stopAfter(startedAt, calendar: calendar) else { return cap }
        return min(stop, cap)
    }

    /// What the Stop automation says when nothing is running, so it is never a bare "was not running".
    public static func notRunningWords(lastStart: LogEntry?, lastEnd: (ms: Double, reason: String?)?, nowMs: Double, calendar: Calendar = .current) -> String {
        let recent = 14.0 * 3600_000
        if let end = lastEnd, nowMs - end.ms < recent, end.reason != StopReason.focusOff.rawValue, end.reason != StopReason.app.rawValue, end.reason != StopReason.scheduled.rawValue {
            return "Sleep sounds stopped at \(timeWords(end.ms, calendar: calendar)). \(stopReasonWords(end.reason))"
        }
        if let s = lastStart, s.kind == "start", nowMs - s.at < recent, let r = StartResult(rawValue: s.result), r != .started, r != .alreadyRunning {
            return "Sleep sounds never started at \(timeWords(s.at, calendar: calendar)). \(startFailureWords(r))"
        }
        if lastStart == nil || nowMs - (lastStart?.at ?? 0) >= recent {
            return "Sleep sounds did not start last night. Open Pepito+ and tap Start sleep sounds before bed."
        }
        return "Sleep sounds was not running."
    }

    /// Where the bedtime check notifications go: one a night for the next `days` nights, `offsetMin` after bedtime.
    public static let checkPrefix = "pepito.sounds.check."
    public static func checkTimes(bedtime: String, now: Date, offsetMin: Int = 10, days: Int = 7, calendar: Calendar = .current) -> [(id: String, fire: Date)] {
        let parts = bedtime.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return [] }
        var out: [(id: String, fire: Date)] = []
        for d in 0..<(days + 1) {
            guard let day = calendar.date(byAdding: .day, value: d, to: calendar.startOfDay(for: now)),
                  let bed = calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day) else { continue }
            let fire = bed.addingTimeInterval(Double(offsetMin) * 60)
            guard fire > now else { continue }
            let c = calendar.dateComponents([.year, .month, .day], from: fire)
            out.append((checkPrefix + "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)", fire))
        }
        return Array(out.prefix(days))
    }

    /// Listening has started: the checks due in the next 12 hours are not needed.
    public static func checksToCancel(_ pending: [(id: String, fire: Date)], startedAt: Date) -> [String] {
        pending.filter { $0.id.hasPrefix(checkPrefix) && $0.fire >= startedAt.addingTimeInterval(-3600) && $0.fire <= startedAt.addingTimeInterval(12 * 3600) }.map(\.id)
    }

    // MARK: the phone moving

    /// A minute with the phone moving: device motion above 0.05 g for 5 seconds or more of it.
    public static let movingG = 0.05
    /// More than this many moving minutes in a night: the phone was probably in the bed.
    public static let movedALotMinutes = 10

    public static func movingMinutes(_ samples: [(t: Double, g: Double)]) -> Int {
        let byMin = Dictionary(grouping: samples.filter { $0.g > movingG }, by: { ($0.t / 60).rounded(.down) })
        return byMin.values.filter { $0.count >= 5 }.count
    }
}

/// One night of Sleep sounds, as the iPhone hands it to the web layer.
public struct SleepSoundsSession: Codable, Equatable, Sendable {
    public var id: String
    public var start: Double         // epoch ms
    public var end: Double           // the last checkpoint while open, the stop time once finished
    public var events: [SleepSoundsCore.Event]
    /// [minute start epoch ms, dB relative to full scale]
    public var levels: [[Double]]
    public var loudMinutes: Int
    public var movingMinutes: Int
    /// the phone moved a lot: snoring readings are less reliable
    public var lowConfidence: Bool
    /// HomeKit bedroom readings, every 5 minutes: [epoch ms, °C, humidity % or -1]
    public var room: [[Double]]
    public var startedBy: String     // "app", "shortcut", "automation"
    public var stopReason: String?
    /// still listening (or the app closed before it could finish): written at start and at each checkpoint
    public var open: Bool
    public var lastCheckpoint: Double
    /// stretches with no audio: interruptions and route changes
    public var gaps: [SleepSoundsCore.Gap]
    public var checkpoints: Int
    /// found open on a later launch and closed at its last checkpoint
    public var recovered: Bool

    public init(id: String, start: Double, end: Double, events: [SleepSoundsCore.Event], levels: [[Double]], loudMinutes: Int,
                movingMinutes: Int, lowConfidence: Bool, room: [[Double]], startedBy: String, stopReason: String?,
                open: Bool = false, lastCheckpoint: Double? = nil, gaps: [SleepSoundsCore.Gap] = [], checkpoints: Int = 0, recovered: Bool = false) {
        self.id = id; self.start = start; self.end = end; self.events = events; self.levels = levels; self.loudMinutes = loudMinutes
        self.movingMinutes = movingMinutes; self.lowConfidence = lowConfidence; self.room = room; self.startedBy = startedBy; self.stopReason = stopReason
        self.open = open; self.lastCheckpoint = lastCheckpoint ?? end; self.gaps = gaps; self.checkpoints = checkpoints; self.recovered = recovered
    }

    enum CodingKeys: String, CodingKey {
        case id, start, end, events, levels, loudMinutes, movingMinutes, lowConfidence, room, startedBy, stopReason
        case open, lastCheckpoint, gaps, checkpoints, recovered
    }

    /// Files written before checkpoints existed have none of the newer keys.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        start = try c.decode(Double.self, forKey: .start)
        end = try c.decode(Double.self, forKey: .end)
        events = try c.decode([SleepSoundsCore.Event].self, forKey: .events)
        levels = try c.decode([[Double]].self, forKey: .levels)
        loudMinutes = try c.decode(Int.self, forKey: .loudMinutes)
        movingMinutes = try c.decode(Int.self, forKey: .movingMinutes)
        lowConfidence = try c.decode(Bool.self, forKey: .lowConfidence)
        room = try c.decode([[Double]].self, forKey: .room)
        startedBy = try c.decode(String.self, forKey: .startedBy)
        stopReason = try c.decodeIfPresent(String.self, forKey: .stopReason)
        open = try c.decodeIfPresent(Bool.self, forKey: .open) ?? false
        lastCheckpoint = try c.decodeIfPresent(Double.self, forKey: .lastCheckpoint) ?? end
        gaps = try c.decodeIfPresent([SleepSoundsCore.Gap].self, forKey: .gaps) ?? []
        checkpoints = try c.decodeIfPresent(Int.self, forKey: .checkpoints) ?? 0
        recovered = try c.decodeIfPresent(Bool.self, forKey: .recovered) ?? false
    }
}
