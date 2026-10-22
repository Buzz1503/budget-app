import Foundation

/// A reminder as the web layer schedules it (src/native/notifySchedule.js).
/// iOS gets exactly these; the buttons on them become queued actions here.
public struct PlannedNotification: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var body: String
    /// ISO 8601
    public var fireAt: String
    public var category: String
    public var threadId: String
    public var timeSensitive: Bool
    public var payload: NotificationPayload

    public var fireDate: Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: fireAt) ?? ISO8601DateFormatter().date(from: fireAt)
    }
}

public struct NotificationPayload: Codable, Equatable, Sendable {
    public struct GroupRef: Codable, Equatable, Sendable {
        public var id: String
        public var refIds: [String]
    }
    public struct ItemRef: Codable, Equatable, Sendable {
        public var refId: String
        public var kind: String
        public var canPush: Bool
    }
    public var kind: String
    public var date: String?
    public var slot: String?
    public var groups: [GroupRef]?
    public var items: [ItemRef]?
    public var pushable: [String]?
    public var route: String?
    public var nudge: Bool?
    /// A stock notice's compound
    public var refId: String?
    /// A vial question: change (the vial should be about empty) or expired (past its fridge life)
    public var vialKind: String?

    public init(kind: String, date: String? = nil, slot: String? = nil, groups: [GroupRef]? = nil, items: [ItemRef]? = nil,
                pushable: [String]? = nil, route: String? = nil, nudge: Bool? = nil, refId: String? = nil, vialKind: String? = nil) {
        self.kind = kind; self.date = date; self.slot = slot; self.groups = groups; self.items = items
        self.pushable = pushable; self.route = route; self.nudge = nudge; self.refId = refId; self.vialKind = vialKind
    }

    /// Stored in the notification's userInfo as JSON under this key.
    public static let userInfoKey = "pepito"

    public func json() -> String {
        (try? String(data: JSONEncoder().encode(self), encoding: .utf8)) ?? "{}"
    }

    public static func from(userInfo: [AnyHashable: Any]) -> NotificationPayload? {
        guard let s = userInfo[userInfoKey] as? String, let d = s.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(NotificationPayload.self, from: d)
    }
}

/// Categories and button ids. The button titles are the app's own words.
public enum NotificationAction {
    public static let log = "pepito.log"
    public static let take = "pepito.take"
    public static let skip = "pepito.skip"
    public static let snooze = "pepito.snooze"
    public static let push = "pepito.push"
    public static let stopSauna = "pepito.sauna.stop"
    public static let openStock = "pepito.stock.open"
    public static let openReaction = "pepito.reaction.open"
    public static let vialYes = "pepito.vial.yes"
    public static let vialStill = "pepito.vial.still"
    public static let vialNotYet = "pepito.vial.notyet"
    public static let orderSnooze = "pepito.order.snooze"
    public static let openCount = "pepito.count.open"

    public static let snoozeMinutes = 30
    public static let schedulePrefix = "pepito.sched."
    public static let snoozePrefix = "pepito.snooze."

    /// Category id, then (button id, title, opens the app) in order.
    public static let categories: [(String, [(String, String, Bool)])] = [
        ("DOSE_LOG_PUSH", [(log, "Log", false), (skip, "Skip", false), (snooze, "Remind in 30 min", false), (push, "Push to tomorrow", false)]),
        ("DOSE_LOG", [(log, "Log", false), (skip, "Skip", false), (snooze, "Remind in 30 min", false)]),
        ("DOSE_TAKE", [(take, "Take", false), (skip, "Skip", false), (snooze, "Remind in 30 min", false)]),
        ("REACTION", [(openReaction, "Check now", true)]),
        ("SAUNA_DONE", [(stopSauna, "Stop session", false)]),
        ("STOCK", [(openStock, "Open Stock", true)]),
        // order-by notice, the question after a log, the fridge-life question, the weekly count
        ("ORDER", [(orderSnooze, "Remind me in 3 days", false), (openStock, "Open Stock", true)]),
        ("VIAL_CHANGE", [(vialYes, "Yes", false), (vialStill, "Still some left", false)]),
        ("VIAL_EXPIRED", [(vialYes, "Yes", false), (vialNotYet, "Not yet", false)]),
        ("COUNT", [(openCount, "Count now", true)])
    ]

    /// The same categories as the Watch shows them: a dose reminder has
    /// Log all (Take all for supplements), Skip and Remind in 30 min, each
    /// handled on the Watch and queued for the iPhone.
    public static let watchCategories: [(String, [(String, String, Bool)])] = categories.map { id, buttons in
        guard id.hasPrefix("DOSE_") else { return (id, buttons) }
        let main = id == "DOSE_TAKE" ? (take, "Take all", false) : (log, "Log all", false)
        return (id, [main, (skip, "Skip", false), (snooze, "Remind in 30 min", false)])
    }

    /// The queued actions a button on a dose notification stands for. A group
    /// logs (or skips) as one; Push moves only what can be pushed.
    public static func actions(for button: String, payload p: NotificationPayload, now: Date = Date()) -> [PendingAction] {
        switch button {
        case vialYes, vialStill, vialNotYet:
            guard p.kind == "vial", let id = p.refId else { return [] }
            let answer = button == vialYes ? "yes" : button == vialStill ? "still" : "notyet"
            return [PendingAction(type: .vialChange, at: now, source: .notification,
                                  payload: .init(kind: p.vialKind ?? "change", refId: id, answer: answer))]
        case orderSnooze:
            guard p.kind == "order", let id = p.refId else { return [] }
            return [PendingAction(type: .snoozeOrder, at: now, source: .notification, payload: .init(refId: id))]
        default:
            break
        }
        guard p.kind == "dose", let date = p.date else { return [] }
        let groups = p.groups ?? []
        let items = p.items ?? []
        switch button {
        case log, take:
            return groups.map { g in
                PendingAction(type: .logDose, at: now, source: .notification,
                              payload: .init(date: date, kind: "peptide", refIds: g.refIds, group: true))
            } + items.map { i in
                PendingAction(type: .logDose, at: now, source: .notification,
                              payload: .init(date: date, kind: i.kind, refId: i.refId))
            }
        case skip:
            return groups.map { g in
                PendingAction(type: .skipDose, at: now, source: .notification,
                              payload: .init(date: date, kind: "peptide", refIds: g.refIds))
            } + items.map { i in
                PendingAction(type: .skipDose, at: now, source: .notification,
                              payload: .init(date: date, kind: i.kind, refId: i.refId))
            }
        case push:
            let refs = p.pushable ?? []
            return refs.isEmpty ? [] : [PendingAction(type: .pushDose, at: now, source: .notification,
                                                      payload: .init(date: date, kind: "peptide", refIds: refs))]
        case snooze:
            let refs = groups.flatMap(\.refIds) + items.map(\.refId)
            return [PendingAction(type: .snoozeDose, at: now, source: .notification,
                                  payload: .init(date: date, slot: p.slot, refIds: refs))]
        default:
            return []
        }
    }

    /// Dose reminders and nudges whose slot has nothing left due in the
    /// snapshot. Removed after a widget or Watch tick, so the nudge does not
    /// fire for a dose that has just been logged.
    public static func stale(pending: [(id: String, payload: NotificationPayload)], snapshot: Snapshot) -> [String] {
        pending.compactMap { entry in
            let p = entry.payload
            guard p.kind == "dose", let date = p.date, let slotRaw = p.slot, let slot = Snapshot.Slot(rawValue: slotRaw),
                  snapshot.day(date) != nil else { return nil }
            let stillDue = DoseBoard.rows(snapshot, date: date, slot: slot).contains { $0.status == .due }
            return stillDue ? nil : entry.id
        }
    }
}
