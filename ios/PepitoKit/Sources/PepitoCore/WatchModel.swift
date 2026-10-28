import Foundation

/// The Watch app's screens. Home is a menu of these; complications and the
/// Smart Stack open one directly (pepito://doses, pepito://sauna,
/// pepito://readiness, pepito://sleep). The app opens on Home, except while a sauna session
/// runs, when it opens straight to it.
public enum WatchRoute: String, Hashable, Sendable, CaseIterable {
    case doses, sauna, readiness
    /// the evening sheet, from the evening prompt's Log
    case evening
    /// sleep mode: Start sleep, the night screen, the morning (pepito://sleep, the sleep complication)
    case sleep

    public static func from(url: URL) -> WatchRoute? {
        guard url.scheme == "pepito", let host = url.host else { return nil }
        return host == "today" ? .doses : WatchRoute(rawValue: host)
    }

    public var url: URL { URL(string: "pepito://\(rawValue)")! }

    public static func launchPath(saunaRunning: Bool, sleeping: Bool = false) -> [WatchRoute] {
        saunaRunning ? [.sauna] : sleeping ? [.sleep] : []
    }
}

/// Readiness older than six hours shows its "as of" time.
public enum ReadinessAge {
    public static func asOf(_ snap: Snapshot) -> Date? {
        let iso = snap.readiness?.asOf ?? snap.generatedAt
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    public static func isStale(_ snap: Snapshot, now: Date) -> Bool {
        guard let d = asOf(snap) else { return true }
        return now.timeIntervalSince(d) > 6 * 3600
    }
}

/// The one live line under each Home tile, and the Doses screen, worked out
/// from the snapshot so the wording is tested once.
public enum WatchHome {

    public struct Line: Equatable, Sendable {
        public var text: String
        /// "All logged": shown with the accent, since it means done.
        public var done: Bool
        /// A shorter wording for the 41 mm screen, never cut mid-word.
        public var short: String
        public init(text: String, done: Bool, short: String? = nil) { self.text = text; self.done = done; self.short = short ?? text }
        public static func == (a: Line, b: Line) -> Bool { a.text == b.text && a.done == b.done }
    }

    /// "7 am", or "7 am tomorrow" for a slot on the next day.
    public static func slotTime(_ snap: Snapshot, date: String, slot: Snapshot.Slot, now: Date, calendar: Calendar = .current) -> String {
        let clock = DoseBoard.clockLabel(snap.slotTimes.time(for: slot))
        if date == DoseBoard.dateString(now, calendar: calendar) { return clock }
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now).map { DoseBoard.dateString($0, calendar: calendar) }
        return date == tomorrow ? "\(clock) tomorrow" : clock
    }

    public static func doses(_ snap: Snapshot?, now: Date, calendar: Calendar = .current) -> Line {
        guard let snap else { return Line(text: "Open on iPhone", done: false, short: "On iPhone") }
        if snap.paused.active && snap.paused.wholeProtocol { return Line(text: "Paused", done: false) }
        let today = DoseBoard.dateString(now, calendar: calendar)
        guard let active = DoseBoard.activeSlot(snap, now: now, calendar: calendar) else { return Line(text: "All logged", done: true) }
        let time = DoseBoard.clockLabel(snap.slotTimes.time(for: active.slot))
        if active.date != today { return Line(text: "All logged · \(time)", done: true, short: "All logged") }
        let due = DoseBoard.rows(snap, date: active.date, slot: active.slot).filter { $0.status == .due }.count
        return Line(text: "\(due) due · \(time)", done: false, short: "\(due) due")
    }

    public static func sauna(_ snap: Snapshot?) -> Line {
        guard let w = snap?.sauna.week else { return Line(text: "Open on iPhone", done: false, short: "On iPhone") }
        if snap?.sauna.active != nil { return Line(text: "Running", done: false) }
        return Line(text: "\(w.sessions) of \(w.target) this week", done: w.target > 0 && w.sessions >= w.target,
                    short: "\(w.sessions) of \(w.target)")
    }

    /// The Doses screen: the current slot while something in it is due today.
    public struct DoseScreen: Equatable, Sendable {
        public var slot: Snapshot.Slot
        public var date: String
        public var rows: [DoseBoard.Row]
        /// "2 of 4 left"
        public var left: String
        public var dueCount: Int
        public var allLogged: Bool { dueCount == 0 }
        /// "7 am tomorrow" once everything is logged; nil when nothing is due all week.
        public var next: String?
    }

    public static func doseScreen(_ snap: Snapshot?, now: Date, calendar: Calendar = .current) -> DoseScreen? {
        guard let snap else { return nil }
        let today = DoseBoard.dateString(now, calendar: calendar)
        if let active = DoseBoard.activeSlot(snap, now: now, calendar: calendar), active.date == today {
            let rows = DoseBoard.rows(snap, date: active.date, slot: active.slot)
            let due = rows.filter { $0.status == .due }.count
            return DoseScreen(slot: active.slot, date: active.date, rows: rows, left: "\(due) of \(rows.count) left", dueCount: due,
                              next: nil)
        }
        let current = DoseBoard.slot(at: now, splitHour: snap.slotSplitHour, calendar: calendar)
        let rows = DoseBoard.rows(snap, date: today, slot: current)
        let next = DoseBoard.activeSlot(snap, now: now, calendar: calendar).map { slotTime(snap, date: $0.date, slot: $0.slot, now: now, calendar: calendar) }
        return DoseScreen(slot: current, date: today, rows: rows, left: "0 of \(rows.count) left", dueCount: 0, next: next)
    }

    /// The dose line on a Watch row: "3 mg · 30 units", "1 spray", "2 capsules".
    public static func doseLine(_ row: DoseBoard.Row) -> String {
        switch row.content {
        case .group(let g, _):
            return g.line.components(separatedBy: ", ").dropFirst().joined(separator: ", ")
        case .single(let i):
            return [i.dose, i.units].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
    }

    /// The names a row shows: one, or a group's members stacked.
    public static func names(_ row: DoseBoard.Row) -> [String] { row.items.map(\.name) }
}
