import SwiftUI
import PepitoCore
import PepitoTheme

/// Today: the current slot's doses. Tap to log, swipe to skip; a draw-together
/// group is one row that logs the whole group. Log all due logs everything
/// still due in the slot.
struct TodayTab: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let current = store.currentRows()
        let due = current.rows.filter { $0.status == .due }
        NavigationStack {
            List {
                if store.snapshot == nil {
                    Text("Open Pepito+ on your iPhone once to fill this in.")
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(PepitoTheme.Palette.text2)
                } else if let p = store.snapshot?.paused, p.active, p.wholeProtocol {
                    Text("Protocol paused\(p.reason.map { ", \($0)" } ?? "")")
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(PepitoTheme.Palette.text2)
                } else if current.rows.isEmpty {
                    Text("Nothing in \(current.slot.title) today.")
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(PepitoTheme.Palette.text2)
                } else {
                    ForEach(current.rows) { row in
                        DoseRow(row: row, dimmed: dimmed)
                            .swipeActions(edge: .trailing) {
                                if row.status == .due {
                                    Button("Skip") { store.skip(row) }
                                        .tint(PepitoTheme.Palette.surfaceSolid)
                                        .accessibilityLabel("Skip \(row.title)")
                                }
                            }
                    }
                    if !due.isEmpty {
                        Button {
                            store.logAllDue()
                        } label: {
                            Text("Log all due")
                                .font(PepitoTheme.Typography.label)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .listRowBackground(Capsule().fill(PepitoTheme.Palette.surfaceSunk))
                        .accessibilityLabel("Log all \(due.count) due in \(current.slot.title)")
                    } else {
                        Label("All logged", systemImage: "checkmark.circle.fill")
                            .font(PepitoTheme.Typography.label)
                            .foregroundStyle(PepitoTheme.Palette.accent)
                    }
                }
            }
            .navigationTitle(current.slot.title)
        }
    }
}

private struct DoseRow: View {
    @EnvironmentObject private var store: WatchStore
    let row: DoseBoard.Row
    let dimmed: Bool

    var body: some View {
        let done = row.status != .due
        Button {
            if !done { store.log(row) }
        } label: {
            HStack(spacing: PepitoTheme.Space.s8) {
                Image(systemName: row.status == .skipped ? "forward.circle" : done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? PepitoTheme.Palette.accent : PepitoTheme.Palette.text2)
                    .font(.system(size: 20, weight: .semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text(row.isGroup ? row.title : (row.items.first?.name ?? row.title))
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(done ? PepitoTheme.Palette.text3 : PepitoTheme.Palette.text)
                        .lineLimit(2)
                    Text(detail)
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text2)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .opacity(dimmed ? 0.7 : 1)
        }
        .disabled(done)
        .accessibilityLabel(done ? "\(row.title), done" : row.speech)
    }

    private var detail: String {
        if row.isGroup { return row.line }
        guard let i = row.items.first else { return "" }
        return [i.dose, i.units].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
