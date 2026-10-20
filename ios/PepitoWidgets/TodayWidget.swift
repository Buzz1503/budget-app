import WidgetKit
import SwiftUI
import AppIntents
import PepitoCore
import PepitoTheme

/// Today: the next slot's doses, each with a tick. A draw-together group is one
/// row and one tick that logs the whole group. Ticked rows show done straight
/// away (the tap updates the snapshot natively); the app applies the log the
/// next time it runs.
struct TodayWidget: Widget {
    let kind = "PepitoToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            TodayView(entry: entry)
                .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("The next doses to log, with a tick for each.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TodayView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    private var board: (date: String, slot: Snapshot.Slot, rows: [DoseBoard.Row])? {
        guard let s = entry.snapshot, let active = DoseBoard.activeSlot(s, now: entry.date) else { return nil }
        return (active.date, active.slot, DoseBoard.rows(s, date: active.date, slot: active.slot))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s8) {
            if let s = entry.snapshot, s.paused.active, s.paused.wholeProtocol {
                Text("Paused").pepitoCaption()
                Text(s.paused.reason ?? "Protocol paused")
                    .font(PepitoTheme.Typography.label)
                    .foregroundStyle(PepitoTheme.Palette.text2)
                Spacer(minLength: 0)
            } else if let b = board {
                HStack {
                    Text(header(b.date, b.slot)).pepitoCaption()
                    Spacer(minLength: 0)
                    Text("\(b.rows.filter { $0.status != .due }.count)/\(b.rows.count)")
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text3)
                        .accessibilityLabel("\(b.rows.filter { $0.status != .due }.count) of \(b.rows.count) done")
                }
                let limit = family == .systemSmall ? 2 : 3
                let shown = ordered(b.rows).prefix(limit)
                ForEach(Array(shown)) { row in DoseRowView(row: row, compact: family == .systemSmall) }
                if b.rows.count > limit {
                    Text("+\(b.rows.count - limit) more").font(PepitoTheme.Typography.small).foregroundStyle(PepitoTheme.Palette.text3)
                }
                Spacer(minLength: 0)
            } else if entry.snapshot == nil {
                Text("Today").pepitoCaption()
                Text("Open Pepito+ once to fill this in.")
                    .font(PepitoTheme.Typography.label)
                    .foregroundStyle(PepitoTheme.Palette.text2)
                Spacer(minLength: 0)
            } else {
                Text("Today").pepitoCaption()
                Spacer(minLength: 0)
                Label("All logged", systemImage: "checkmark.circle.fill")
                    .font(PepitoTheme.Typography.h2)
                    .foregroundStyle(PepitoTheme.Palette.accent)
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Still due first, so the tick you want is always on screen.
    private func ordered(_ rows: [DoseBoard.Row]) -> [DoseBoard.Row] {
        rows.filter { $0.status == .due } + rows.filter { $0.status != .due }
    }

    private func header(_ date: String, _ slot: Snapshot.Slot) -> String {
        date == DoseBoard.dateString(entry.date) ? slot.title : "Tomorrow, \(slot.title)"
    }
}

struct DoseRowView: View {
    let row: DoseBoard.Row
    let compact: Bool

    var body: some View {
        let done = row.status != .due
        Button(intent: TickDoseIntent(rowId: row.id)) {
            HStack(spacing: PepitoTheme.Space.s8) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(done ? PepitoTheme.Palette.accent : PepitoTheme.Palette.text2)
                VStack(alignment: .leading, spacing: 0) {
                    Text(row.isGroup ? row.title : row.items.first?.name ?? row.title)
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(done ? PepitoTheme.Palette.text3 : PepitoTheme.Palette.text)
                        .lineLimit(1)
                    Text(detail)
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text3)
                        .lineLimit(1)
                }
                .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(done)
        .accessibilityLabel(done ? "\(row.title), done" : row.speech)
    }

    /// "3 mg, 30 units" under the name, or the group's line.
    private var detail: String {
        if row.isGroup { return row.line }
        guard let i = row.items.first else { return "" }
        return [i.dose, i.units].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
