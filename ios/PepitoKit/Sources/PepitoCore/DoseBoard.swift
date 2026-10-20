import Foundation

/// What a surface shows from the snapshot: which slot, and its rows, with
/// draw-together groups collapsed into one row that logs the whole group.
/// Nothing here works out a dose; it only picks rows the web layer prepared.
public enum DoseBoard {

    public static func dateString(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// The slot "now" is in, by Home's rule (before the split hour is AM).
    public static func slot(at now: Date, splitHour: Int, calendar: Calendar = .current) -> Snapshot.Slot {
        calendar.component(.hour, from: now) < splitHour ? .am : .pm
    }

    public struct Row: Identifiable, Equatable, Sendable {
        public enum Content: Equatable, Sendable {
            case single(Snapshot.Item)
            case group(Snapshot.Group, [Snapshot.Item])
        }
        public var content: Content
        public var date: String

        public var id: String {
            switch content {
            case .single(let i): return i.id
            case .group(let g, _): return g.id
            }
        }
        public var items: [Snapshot.Item] {
            switch content {
            case .single(let i): return [i]
            case .group(_, let items): return items
            }
        }
        /// A group is done when none of it is still due.
        public var status: Snapshot.Status {
            let s = items.map(\.status)
            if s.contains(.due) { return .due }
            if s.allSatisfy({ $0 == .skipped }) { return .skipped }
            return .logged
        }
        public var title: String {
            switch content {
            case .single(let i): return i.name
            case .group(let g, _): return g.title
            }
        }
        /// "Reta 3 mg, 30 units"; a group's own line.
        public var line: String {
            switch content {
            case .single(let i): return i.line
            case .group(let g, _): return g.line
            }
        }
        public var verb: String { items.first?.verb ?? "Log" }
        /// What VoiceOver reads on the button: "Log Retatrutide 3 milligrams".
        public var speech: String {
            switch content {
            case .single(let i): return i.speech
            case .group(let g, _): return g.speech
            }
        }
        public var isGroup: Bool { if case .group = content { return true } else { return false } }
        public var canPush: Bool { items.contains { $0.canPush } }
    }

    /// One slot's rows in the snapshot's order, each group once, where its first member was.
    public static func rows(_ snap: Snapshot, date: String, slot: Snapshot.Slot) -> [Row] {
        guard let day = snap.day(date) else { return [] }
        var out: [Row] = []
        var seenGroups = Set<String>()
        for item in day.items where item.slot == slot {
            if let gid = item.groupId, let g = day.groups.first(where: { $0.id == gid }) {
                guard !seenGroups.contains(gid) else { continue }
                seenGroups.insert(gid)
                let members = g.itemIds.compactMap { id in day.items.first { $0.id == id } }
                out.append(Row(content: .group(g, members), date: date))
            } else {
                out.append(Row(content: .single(item), date: date))
            }
        }
        return out
    }

    /// The slot to show now: the current one while it still has something due,
    /// else the next slot (today PM, then the coming days) that has.
    public static func activeSlot(_ snap: Snapshot, now: Date, calendar: Calendar = .current) -> (date: String, slot: Snapshot.Slot)? {
        let today = dateString(now, calendar: calendar)
        let current = slot(at: now, splitHour: snap.slotSplitHour, calendar: calendar)
        for day in snap.days where day.date >= today {
            for s in Snapshot.Slot.allCases {
                if day.date == today && current == .pm && s == .am { continue }
                if rows(snap, date: day.date, slot: s).contains(where: { $0.status == .due }) { return (day.date, s) }
            }
        }
        return nil
    }

    /// Rows still due in the current slot of today (what "Log my doses" logs).
    public static func dueNow(_ snap: Snapshot, now: Date, calendar: Calendar = .current) -> (date: String, slot: Snapshot.Slot, rows: [Row]) {
        let today = dateString(now, calendar: calendar)
        let s = slot(at: now, splitHour: snap.slotSplitHour, calendar: calendar)
        return (today, s, rows(snap, date: today, slot: s).filter { $0.status == .due })
    }

    /// "8 pm", "7:30 am": the same words as the web's clockLabel.
    public static func clockLabel(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard let h = parts.first else { return "" }
        let m = parts.count > 1 ? parts[1] : 0
        let suffix = h < 12 ? "am" : "pm"
        let h12 = h % 12 == 0 ? 12 : h % 12
        return m > 0 ? "\(h12):\(String(format: "%02d", m)) \(suffix)" : "\(h12) \(suffix)"
    }

    /// The next due line, worked out again after a native tick so the Lock
    /// Screen does not keep naming a dose that has just been logged. Same rule
    /// as nextDue in src/native/snapshot.js.
    public static func next(_ snap: Snapshot, now: Date, calendar: Calendar = .current) -> Snapshot.NextDose? {
        let today = dateString(now, calendar: calendar)
        let current = slot(at: now, splitHour: snap.slotSplitHour, calendar: calendar)
        for day in snap.days where day.date >= today {
            for s in Snapshot.Slot.allCases {
                if day.date == today && current == .pm && s == .am { continue }
                let due = day.items.filter { $0.slot == s && $0.status == .due }
                guard let first = due.first else { continue }
                let more = due.count > 1 ? " +\(due.count - 1)" : ""
                let time = snap.slotTimes.time(for: s)
                let line = "\(first.name) \(first.dose)\(more)"
                return Snapshot.NextDose(date: day.date, slot: s, time: time, count: due.count, line: line,
                                         label: "Next: \(line), \(clockLabel(time))")
            }
        }
        return nil
    }
}
