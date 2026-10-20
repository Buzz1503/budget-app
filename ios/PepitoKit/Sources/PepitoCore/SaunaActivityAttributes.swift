import Foundation
#if canImport(ActivityKit) && os(iOS)
import ActivityKit

/// The sauna Live Activity: started with the session, ended on Stop, and
/// treated as over two hours after the start if it was never stopped.
public struct SaunaActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var startedAt: Date
        public var targetAt: Date
        public var tempC: Int
        public var rounds: Int
        public init(startedAt: Date, targetAt: Date, tempC: Int, rounds: Int) {
            self.startedAt = startedAt; self.targetAt = targetAt; self.tempC = tempC; self.rounds = rounds
        }
    }

    public var targetMin: Int
    public init(targetMin: Int) { self.targetMin = targetMin }
}
#endif

/// A session never stopped is closed this long after its start and saved as "needs review".
public enum SaunaLimits {
    public static let autoEndAfter: TimeInterval = 2 * 3600

    public static func isOverdue(startedAtMs: Double, now: Date) -> Bool {
        now.timeIntervalSince1970 * 1000 - startedAtMs >= autoEndAfter * 1000
    }
}
