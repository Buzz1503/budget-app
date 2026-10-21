import Foundation

/// How much a Watch widget matters at a moment, for the Smart Stack: the next
/// dose rises from 30 minutes before its slot until the nudge, the sauna
/// while a session runs, readiness in the morning. Plain numbers here; the
/// widget turns them into TimelineEntryRelevance.
public enum SurfaceRelevance {
    public struct Score: Equatable, Sendable {
        public var score: Float
        public var duration: TimeInterval
        public init(score: Float, duration: TimeInterval) { self.score = score; self.duration = duration }
        public static let low = Score(score: 1, duration: 0)
    }

    public static let leadTime: TimeInterval = 30 * 60
    public static let morning = 5..<11

    /// The slot moment the next dose is due at, if anything is due.
    public static func nextSlot(_ snap: Snapshot, at date: Date, calendar: Calendar = .current) -> Date? {
        guard let next = DoseBoard.next(snap, now: date, calendar: calendar) else { return nil }
        return WatchReminders.moment(next.date, next.time, calendar: calendar)
    }

    public static func nextDose(_ snap: Snapshot?, at date: Date, calendar: Calendar = .current) -> Score {
        guard let snap, !(snap.paused.active && snap.paused.wholeProtocol),
              let slot = nextSlot(snap, at: date, calendar: calendar) else { return .low }
        let until = TimeInterval((snap.notifications?.nudgeDelayMin ?? 90) * 60)
        let from = slot.addingTimeInterval(-leadTime)
        if date >= from && date < slot.addingTimeInterval(until) {
            return Score(score: 80, duration: slot.addingTimeInterval(until).timeIntervalSince(date))
        }
        return Score(score: 10, duration: 0)
    }

    public static func sauna(_ snap: Snapshot?, at date: Date) -> Score {
        guard let a = snap?.sauna.active else { return Score(score: 5, duration: 0) }
        let end = a.startDate.addingTimeInterval(SaunaLimits.autoEndAfter)
        return date < end ? Score(score: 100, duration: end.timeIntervalSince(date)) : Score(score: 5, duration: 0)
    }

    public static func readiness(_ snap: Snapshot?, at date: Date, calendar: Calendar = .current) -> Score {
        guard snap?.readiness?.score != nil else { return .low }
        let h = calendar.component(.hour, from: date)
        guard morning.contains(h), let end = calendar.date(bySettingHour: morning.upperBound, minute: 0, second: 0, of: date) else {
            return Score(score: 10, duration: 0)
        }
        return Score(score: 60, duration: end.timeIntervalSince(date))
    }

    /// The moments a timeline should have an entry for, so relevance changes on time:
    /// 30 minutes before each slot, each nudge, the start and end of the morning,
    /// the slot switch and midnight.
    public static func moments(_ snap: Snapshot?, from now: Date, hours: Double = 24, calendar: Calendar = .current) -> [Date] {
        var out: [Date] = [now]
        let end = now.addingTimeInterval(hours * 3600)
        let start = calendar.startOfDay(for: now)
        for dayOffset in 0...1 {
            guard let day = calendar.date(byAdding: .day, value: dayOffset, to: start) else { continue }
            out.append(day)
            if let split = calendar.date(byAdding: .hour, value: snap?.slotSplitHour ?? 14, to: day) { out.append(split) }
            for h in [morning.lowerBound, morning.upperBound] {
                if let m = calendar.date(byAdding: .hour, value: h, to: day) { out.append(m) }
            }
            if let snap {
                let date = DoseBoard.dateString(day, calendar: calendar)
                let delay = TimeInterval((snap.notifications?.nudgeDelayMin ?? 90) * 60)
                for slot in Snapshot.Slot.allCases {
                    guard let at = WatchReminders.moment(date, snap.slotTimes.time(for: slot), calendar: calendar) else { continue }
                    out.append(at.addingTimeInterval(-leadTime))
                    out.append(at)
                    out.append(at.addingTimeInterval(delay))
                }
            }
        }
        if let a = snap?.sauna.active {
            out.append(a.targetDate)
            out.append(a.startDate.addingTimeInterval(SaunaLimits.autoEndAfter))
        }
        return Array(Set(out.filter { $0 >= now && $0 <= end })).sorted()
    }
}
