import Foundation

/// Actions the Watch has sent but the phone has not yet answered with a
/// snapshot that shows them. Each new snapshot from the phone has them applied
/// on top, so a tick made offline does not flicker back to due when an older
/// snapshot arrives. Applying is idempotent (only a due item changes), and an
/// entry is dropped after a day.
public struct WatchOutbox: Codable, Equatable, Sendable {
    public var actions: [PendingAction] = []
    public static let keepFor: TimeInterval = 24 * 3600

    public init(actions: [PendingAction] = []) { self.actions = actions }

    public mutating func add(_ a: PendingAction) {
        if !actions.contains(where: { $0.id == a.id }) { actions.append(a) }
    }

    /// The snapshot from the phone, with what the Watch did since laid over it.
    public mutating func overlay(_ incoming: Snapshot, now: Date = Date()) -> Snapshot {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        actions.removeAll { a in
            guard let at = iso.date(from: a.at) else { return true }
            return now.timeIntervalSince(at) > WatchOutbox.keepFor
        }
        var s = incoming
        for a in actions where a.type != .saunaCompleted && a.type != .startSauna && a.type != .stopSauna {
            s.apply(a, now: now)
        }
        return s
    }
}
