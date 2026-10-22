import Foundation

/// The dose reminders the Watch schedules for itself, from the snapshot alone,
/// when More › Notifications › Remind me on is Watch or Both. Same rule as
/// buildSchedule in src/native/notifySchedule.js: one reminder per slot with
/// something still due, listing each item or draw-together group, and one
/// nudge after the delay. Same ids too, so with Both the system shows one of
/// each on the wrist. A Swift test checks the two plans match.
public enum WatchReminders {

    public struct Reminder: Equatable, Sendable {
        public var id: String
        public var title: String
        public var body: String
        public var fireDate: Date
        public var category: String
        public var threadId: String
        public var timeSensitive: Bool
        public var payload: NotificationPayload
    }

    /// The Watch schedules dose reminders for Watch and Both.
    public static func watchSchedules(_ snap: Snapshot) -> Bool {
        let on = snap.notifications?.remindOn ?? "watch"
        return on == "watch" || on == "both"
    }

    /// "Draw together: BPC-157 + TB-500, 50 units", or the item's own line.
    public static func line(_ row: DoseBoard.Row) -> String {
        switch row.content {
        case .single(let i): return i.line
        case .group(let g, _):
            let units = g.line.components(separatedBy: ", ").dropFirst().joined(separator: ", ")
            return units.isEmpty ? g.title : "\(g.title), \(units)"
        }
    }

    /// The buttons a reminder gets: Take for supplements only, Push when something can move.
    public static func category(_ rows: [DoseBoard.Row]) -> String {
        let items = rows.flatMap(\.items)
        if items.allSatisfy({ $0.kind == .supplement }) { return "DOSE_TAKE" }
        return items.contains { $0.canPush } ? "DOSE_LOG_PUSH" : "DOSE_LOG"
    }

    static func payload(_ rows: [DoseBoard.Row], date: String, slot: Snapshot.Slot, nudge: Bool) -> NotificationPayload {
        var groups: [NotificationPayload.GroupRef] = []
        var items: [NotificationPayload.ItemRef] = []
        for r in rows {
            switch r.content {
            case .group(let g, _): groups.append(.init(id: g.id, refIds: g.refIds))
            case .single(let i): items.append(.init(refId: i.refId, kind: i.kind.rawValue, canPush: i.canPush))
            }
        }
        let pushable = rows.flatMap(\.items).filter(\.canPush).map(\.refId)
        return NotificationPayload(kind: "dose", date: date, slot: slot.rawValue, groups: groups, items: items,
                                   pushable: pushable, nudge: nudge ? true : nil)
    }

    /// A local date and "HH:MM" as a moment.
    public static func moment(_ date: String, _ hhmm: String, calendar: Calendar = .current) -> Date? {
        let d = date.split(separator: "-").compactMap { Int($0) }
        let t = hhmm.split(separator: ":").compactMap { Int($0) }
        guard d.count == 3 else { return nil }
        var c = DateComponents()
        c.year = d[0]; c.month = d[1]; c.day = d[2]
        c.hour = t.first ?? 0; c.minute = t.count > 1 ? t[1] : 0; c.second = 0
        return calendar.date(from: c)
    }

    /// Every reminder and nudge still ahead, over the days the snapshot carries.
    public static func plan(_ snap: Snapshot, now: Date, calendar: Calendar = .current) -> [Reminder] {
        let n = snap.notifications
        let doses = n?.doses ?? true
        let nudges = n?.nudges ?? true
        let delay = TimeInterval((n?.nudgeDelayMin ?? 90) * 60)
        let timeSensitive = n?.timeSensitive ?? true
        var out: [Reminder] = []
        for day in snap.days {
            for slot in Snapshot.Slot.allCases {
                let rows = DoseBoard.rows(snap, date: day.date, slot: slot).filter { $0.status == .due }
                guard !rows.isEmpty, let fire = moment(day.date, snap.slotTimes.time(for: slot), calendar: calendar) else { continue }
                let body = rows.map(line).joined(separator: "\n")
                let thread = "pepito.slot.\(slot.rawValue)"
                let cat = category(rows)
                if doses && fire > now {
                    out.append(Reminder(id: "\(NotificationAction.schedulePrefix)dose.\(day.date).\(slot.rawValue)", title: slot.title,
                                        body: body, fireDate: fire, category: cat, threadId: thread, timeSensitive: timeSensitive,
                                        payload: payload(rows, date: day.date, slot: slot, nudge: false)))
                }
                let nudgeAt = fire.addingTimeInterval(delay)
                if nudges && nudgeAt > now {
                    out.append(Reminder(id: "\(NotificationAction.schedulePrefix)nudge.\(day.date).\(slot.rawValue)", title: slot.title,
                                        body: "Still to log:\n\(body)", fireDate: nudgeAt, category: cat, threadId: thread,
                                        timeSensitive: timeSensitive, payload: payload(rows, date: day.date, slot: slot, nudge: true)))
                }
            }
        }
        out += restartReminders(snap, now: now, calendar: calendar)
        out += stockReminders(snap, now: now)
        return out
    }

    /// Order-by, fridge-life and weekly-count notices still ahead. The iPhone builds
    /// them (src/native/stockNotices.js) and puts the same entries in the snapshot, so
    /// the ids match and with Both the wrist shows one of each.
    static func stockReminders(_ snap: Snapshot, now: Date) -> [Reminder] {
        (snap.stock?.notices ?? []).compactMap { n in
            guard let fire = n.fireDate, fire > now else { return nil }
            return Reminder(id: n.id, title: n.title, body: n.body, fireDate: fire, category: n.category,
                            threadId: n.threadId ?? "pepito.stock", timeSensitive: false, payload: n.payload)
        }
    }

    /// "Epithalon restarts tomorrow", "Epithalon and KPV restart tomorrow", "A, B and C restart tomorrow".
    public static func restartWords(_ names: [String]) -> String {
        let list: String
        switch names.count {
        case 0: list = ""
        case 1: list = names[0]
        default: list = "\(names.dropLast().joined(separator: ", ")) and \(names[names.count - 1])"
        }
        return "\(list) \(names.count > 1 ? "restart" : "restarts") tomorrow"
    }

    /// The evening before each compound comes back on cycle: a rest is not a due
    /// day, so it has no dose reminder, and this is the one sentence about it.
    static func restartReminders(_ snap: Snapshot, now: Date, calendar: Calendar) -> [Reminder] {
        guard snap.notifications?.restarts ?? true else { return [] }
        let time = snap.notifications?.restartTime ?? "19:00"
        var out: [Reminder] = []
        for r in snap.cycles?.restarts ?? [] {
            guard let restartDay = moment(r.date, "00:00", calendar: calendar),
                  let before = calendar.date(byAdding: .day, value: -1, to: restartDay),
                  let fire = moment(DoseBoard.dateString(before, calendar: calendar), time, calendar: calendar),
                  fire > now, !r.names.isEmpty else { continue }
            out.append(Reminder(id: "\(NotificationAction.schedulePrefix)restart.\(r.date)", title: "Restarts tomorrow",
                                body: restartWords(r.names), fireDate: fire, category: "RESTART", threadId: "pepito.restart",
                                timeSensitive: false, payload: NotificationPayload(kind: "restart", date: r.date, route: "protocol")))
        }
        return out
    }
}
