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

    public enum StopReason: String, Sendable { case focusOff, unplugged, tooLong }
    public static let maxHours = 11.0

    /// Whether a running session should stop: unplugged after 4 am, or past 11 hours.
    /// (Sleep Focus turning off arrives as the Stop sleep sounds shortcut.)
    public static func shouldStop(startedAt: Date, now: Date, pluggedIn: Bool, calendar: Calendar = .current) -> StopReason? {
        if now.timeIntervalSince(startedAt) >= maxHours * 3600 { return .tooLong }
        let h = calendar.component(.hour, from: now)
        if !pluggedIn, h >= 4, h < 12, now.timeIntervalSince(startedAt) > 3600 { return .unplugged }
        return nil
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
    public var end: Double
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

    public init(id: String, start: Double, end: Double, events: [SleepSoundsCore.Event], levels: [[Double]], loudMinutes: Int,
                movingMinutes: Int, lowConfidence: Bool, room: [[Double]], startedBy: String, stopReason: String?) {
        self.id = id; self.start = start; self.end = end; self.events = events; self.levels = levels; self.loudMinutes = loudMinutes
        self.movingMinutes = movingMinutes; self.lowConfidence = lowConfidence; self.room = room; self.startedBy = startedBy; self.stopReason = stopReason
    }
}
