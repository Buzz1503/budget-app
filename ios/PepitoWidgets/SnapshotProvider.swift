import WidgetKit
import Foundation
import PepitoCore

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

/// Every widget reads the snapshot. A timeline has an entry now and at each
/// moment the picture changes on its own: the slot switch, midnight (the
/// snapshot carries the next two days), and a running session's target. The
/// app and every tap reload it as well.
struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: Date(), snapshot: nil) }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: SharedStore.shared().readSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let snap = SharedStore.shared().readSnapshot()
        completion(Timeline(entries: SnapshotProvider.entries(snap, now: Date()), policy: .after(Date().addingTimeInterval(30 * 60))))
    }

    static func entries(_ snap: Snapshot?, now: Date, calendar: Calendar = .current) -> [SnapshotEntry] {
        var moments: [Date] = [now]
        let startOfDay = calendar.startOfDay(for: now)
        let split = calendar.date(byAdding: .hour, value: snap?.slotSplitHour ?? 14, to: startOfDay)!
        if split > now { moments.append(split) }
        if let midnight = calendar.date(byAdding: .day, value: 1, to: startOfDay) { moments.append(midnight) }
        if let a = snap?.sauna.active, a.targetDate > now { moments.append(a.targetDate) }
        return moments.sorted().map { SnapshotEntry(date: $0, snapshot: snap) }
    }
}
