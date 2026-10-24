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
    /// The AM reminder's "Took Dex": the as-needed item and the amount it logs
    public var took: TookRef?

    public struct TookRef: Codable, Equatable, Sendable {
        public var refId: String
        public var amount: Double
        public var unit: String
        public init(refId: String, amount: Double, unit: String) { self.refId = refId; self.amount = amount; self.unit = unit }
    }

    public init(kind: String, date: String? = nil, slot: String? = nil, groups: [GroupRef]? = nil, items: [ItemRef]? = nil,
                pushable: [String]? = nil, route: String? = nil, nudge: Bool? = nil, refId: String? = nil, vialKind: String? = nil,
                took: TookRef? = nil) {
        self.kind = kind; self.date = date; self.slot = slot; self.groups = groups; self.items = items
        self.pushable = pushable; self.route = route; self.nudge = nudge; self.refId = refId; self.vialKind = vialKind
        self.took = took
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
    // Sleep Lab
    public static let eveningNothing = "pepito.evening.nothing"
    public static let eveningLog = "pepito.evening.log"
    public static let restedPrefix = "pepito.rested."
    public static let dreamsPrefix = "pepito.dreams."
    public static let took = "pepito.took"

    /// The morning check's one-tap answers: rested 1 to 5, then dreams.
    public static let restedButtons: [(String, String, Bool)] = [
        ("\(restedPrefix)1", "1 Not rested", false), ("\(restedPrefix)2", "2", false), ("\(restedPrefix)3", "3", false),
        ("\(restedPrefix)4", "4", false), ("\(restedPrefix)5", "5 Fully rested", false)
    ]
    public static let dreamButtons: [(String, String, Bool)] = [
        ("\(dreamsPrefix)none", "None remembered", false), ("\(dreamsPrefix)normal", "Normal", false),
        ("\(dreamsPrefix)vivid", "Vivid", false), ("\(dreamsPrefix)nightmare", "Nightmare", false)
    ]

    public static let snoozeMinutes = 30
    public static let schedulePrefix = "pepito.sched."
    public static let snoozePrefix = "pepito.snooze."

    /// Category id, then (button id, title, opens the app) in order. The AM
    /// reminder's "_TOOK" variants add "Took Dex" (the snapshot's `sleep.took`).
    public static func categories(took short: String?) -> [(String, [(String, String, Bool)])] {
        let tookButton = (took, short.map { "Took \($0)" } ?? "Took last amount", false)
        let sleep: [(String, [(String, String, Bool)])] = [
            ("EVENING", [(eveningNothing, "Nothing unusual", false), (eveningLog, "Log", true)]),
            ("MORNING", restedButtons),
            ("MORNING_DREAMS", dreamButtons)
        ]
        return baseCategories + baseCategories.filter { $0.0.hasPrefix("DOSE_") }.map { ("\($0.0)_TOOK", $0.1 + [tookButton]) } + sleep
    }

    public static var categories: [(String, [(String, String, Bool)])] { categories(took: nil) }

    static let baseCategories: [(String, [(String, String, Bool)])] = [
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
    public static func watchCategories(took short: String?) -> [(String, [(String, String, Bool)])] {
        categories(took: short).map { id, buttons in
            guard id.hasPrefix("DOSE_") else { return (id, buttons) }
            let main = id.hasPrefix("DOSE_TAKE") ? (take, "Take all", false) : (log, "Log all", false)
            let extra = buttons.filter { $0.0 == took }
            return (id, [main, (skip, "Skip", false), (snooze, "Remind in 30 min", false)] + extra)
        }
    }

    public static var watchCategories: [(String, [(String, String, Bool)])] { watchCategories(took: nil) }

    /// After a rested tap, the dreams question as its own notification, so each is one tap.
    public static func followUp(for button: String, payload p: NotificationPayload) -> (id: String, title: String, body: String, category: String, payload: NotificationPayload)? {
        guard button.hasPrefix(restedPrefix), p.kind == "morning", let date = p.date else { return nil }
        return ("pepito.dreams.\(date)", "Morning check", "Any dreams?", "MORNING_DREAMS",
                NotificationPayload(kind: "morning", date: date, route: "sleep"))
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
        case took:
            guard let t = p.took else { return [] }
            return [.asNeeded(t.refId, amount: t.amount, unit: t.unit, takenAt: now, source: .notification)]
        case eveningNothing:
            guard p.kind == "evening", let date = p.date else { return [] }
            return [PendingAction(type: .eveningNothing, at: now, source: .notification, payload: .init(date: date))]
        case _ where button.hasPrefix(restedPrefix):
            guard p.kind == "morning", let date = p.date, let n = Int(button.dropFirst(restedPrefix.count)), (1...5).contains(n) else { return [] }
            return [PendingAction(type: .morningCheck, at: now, source: .notification, payload: .init(date: date, rested: n))]
        case _ where button.hasPrefix(dreamsPrefix):
            let d = String(button.dropFirst(dreamsPrefix.count))
            guard p.kind == "morning", let date = p.date, ["none", "normal", "vivid", "nightmare"].contains(d) else { return [] }
            return [PendingAction(type: .morningCheck, at: now, source: .notification, payload: .init(date: date, dreams: d))]
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
