import Foundation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit

/// The Sleep sounds Live Activity: "Sleep sounds listening · until 5:00" with a Stop
/// button. iOS needs one on screen while an AudioRecordingIntent keeps the microphone.
public struct SleepSoundsActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var startedAt: Date
        public var until: Date
        /// another app or a call has the microphone for now
        public var paused: Bool
        public init(startedAt: Date, until: Date, paused: Bool = false) {
            self.startedAt = startedAt; self.until = until; self.paused = paused
        }
    }
    public init() {}
}
#endif

/// Sleep sounds on a schedule: every night from `start` to `stop` ("HH:MM", 24 hour).
/// A stop at or before the start runs across midnight (21:00 to 05:00).
public struct SleepSoundsSchedule: Codable, Equatable, Sendable {
    public var on: Bool
    public var start: String
    public var stop: String

    public static let standard = SleepSoundsSchedule(on: true, start: "21:00", stop: "05:00")
    public static let defaultsKey = "pepito.sleepsounds.schedule"

    public init(on: Bool, start: String, stop: String) { self.on = on; self.start = start; self.stop = stop }

    /// Minutes after midnight for "HH:MM", or nil.
    public static func minutes(_ hhmm: String) -> Int? {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2, (0..<24).contains(p[0]), (0..<60).contains(p[1]) else { return nil }
        return p[0] * 60 + p[1]
    }

    /// Whether a moment falls inside the nightly window.
    public func contains(_ now: Date, calendar: Calendar = .current) -> Bool {
        guard let a = Self.minutes(start), let b = Self.minutes(stop) else { return false }
        let c = calendar.dateComponents([.hour, .minute], from: now)
        let m = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return a < b ? (m >= a && m < b) : (m >= a || m < b)
    }

    /// The first stop time after `from`: when a session started then should end.
    public func stopAfter(_ from: Date, calendar: Calendar = .current) -> Date? {
        guard let b = Self.minutes(stop) else { return nil }
        let day = calendar.startOfDay(for: from)
        for d in 0...1 {
            guard let base = calendar.date(byAdding: .day, value: d, to: day),
                  let t = calendar.date(bySettingHour: b / 60, minute: b % 60, second: 0, of: base) else { continue }
            if t > from { return t }
        }
        return nil
    }

    /// "until 5:00"
    public var untilWords: String {
        guard let b = Self.minutes(stop) else { return "" }
        return "until \(b / 60):\(b % 60 < 10 ? "0" : "")\(b % 60)"
    }
}
