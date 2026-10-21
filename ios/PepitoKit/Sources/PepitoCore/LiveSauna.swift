import Foundation

/// What the Watch tells the iPhone every 30 seconds while a sauna session
/// runs, so the Live Activity shows the live heart rate and the round. Sent
/// as a WatchConnectivity message only (never queued, never stored): a
/// reading that arrives late is not live any more.
public struct LiveSauna: Codable, Equatable, Sendable {
    public static let messageKey = "liveSauna"
    public static let interval: TimeInterval = 30

    public var heartRate: Int?
    public var rounds: Int
    /// epoch milliseconds
    public var at: Double

    public init(heartRate: Int?, rounds: Int, at: Date) {
        self.heartRate = heartRate; self.rounds = rounds; self.at = at.timeIntervalSince1970 * 1000
    }

    public func message() -> [String: Any] {
        guard let d = try? JSONEncoder().encode(self) else { return [:] }
        return [LiveSauna.messageKey: d]
    }

    public static func from(message: [String: Any]) -> LiveSauna? {
        guard let d = message[messageKey] as? Data else { return nil }
        return try? JSONDecoder().decode(LiveSauna.self, from: d)
    }

    /// A reading older than a minute and a half is not shown as live.
    public func isFresh(now: Date) -> Bool { now.timeIntervalSince1970 * 1000 - at <= 90_000 }
}
