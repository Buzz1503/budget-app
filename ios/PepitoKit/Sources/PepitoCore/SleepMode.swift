import Foundation

/// The Watch's Sleep tile and complication: read-only, from Apple Health
/// through the snapshot's `sleep.lastNight`. Last night's duration and sleep
/// score, and a one-screen summary on tap. Nothing is started or recorded on
/// the Watch for sleep; Apple's own sleep tracking (Sleep Focus on, Watch
/// worn) is the source.
public enum SleepMode {

    /// "6 h 48 m"
    public static func duration(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        return h > 0 ? "\(h) h \(m) m" : "\(m) m"
    }

    /// The Home tile's line: "Last night 6 h 48 m", or "No night yet".
    public static func tileLine(lastNight: Snapshot.LastNight?) -> WatchHome.Line {
        guard let n = lastNight?.asleepMin else { return WatchHome.Line(text: "No night yet", done: false, short: "No night") }
        return WatchHome.Line(text: "Last night \(duration(n))", done: false, short: duration(n))
    }

    // MARK: - the complication

    public enum Complication: Equatable, Sendable {
        /// last night's sleep score
        case score(Int)
        /// no score: the hours asleep
        case hours(Int)
        case empty
    }

    public static func complication(lastNight: Snapshot.LastNight?) -> Complication {
        if let s = lastNight?.score { return .score(s) }
        if let m = lastNight?.asleepMin { return .hours(m) }
        return .empty
    }

    // MARK: - the summary

    /// The one-screen summary of last night.
    public struct Summary: Equatable, Sendable {
        public var asleepMin: Int
        public var score: Int?
        public var readiness: Int?
        public var wakeUps: Int?
        public var awakeMin: Int?
        public init(asleepMin: Int, score: Int? = nil, readiness: Int? = nil, wakeUps: Int? = nil, awakeMin: Int? = nil) {
            self.asleepMin = asleepMin; self.score = score; self.readiness = readiness; self.wakeUps = wakeUps; self.awakeMin = awakeMin
        }
    }

    public static func summary(lastNight: Snapshot.LastNight?) -> Summary? {
        guard let l = lastNight, let asleep = l.asleepMin else { return nil }
        return Summary(asleepMin: asleep, score: l.score, readiness: l.readiness, wakeUps: l.wakeUps, awakeMin: l.awakeMin)
    }
}
