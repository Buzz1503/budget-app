#if os(iOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

/// What the dose widgets show, from the snapshot and the moment.
public enum DoseWidgetState: Equatable {
    case empty
    case paused(until: String?)
    case allLogged(next: String?)
    /// header "AM · 3 due", the first row still due, every row in the slot
    case due(slot: Snapshot.Slot, dueCount: Int, first: DoseBoard.Row, rows: [DoseBoard.Row])

    public init(_ snap: Snapshot?, now: Date, calendar: Calendar = .current) {
        guard let snap else { self = .empty; return }
        if snap.paused.active && snap.paused.wholeProtocol { self = .paused(until: WidgetText.until(snap.paused.until)); return }
        guard let screen = WatchHome.doseScreen(snap, now: now, calendar: calendar) else { self = .empty; return }
        if screen.allLogged {
            self = .allLogged(next: screen.next)
        } else if let first = screen.rows.first(where: { $0.status == .due }) {
            self = .due(slot: screen.slot, dueCount: screen.dueCount, first: first, rows: screen.rows)
        } else {
            self = .allLogged(next: screen.next)
        }
    }
}

// MARK: - Next dose (small)

/// The next dose to log, its dose as the hero and the syringe units under it,
/// and one Log button. A draw-together group is one dose: its names, its total units.
public struct NextDoseSmallView: View {
    let state: DoseWidgetState
    @Environment(\.surfaceMode) private var mode
    @Environment(\.isStandBy) private var standBy
    @Environment(\.widgetActions) private var actions

    public init(state: DoseWidgetState) { self.state = state }

    public var body: some View {
        let ink = Ink(mode: mode)
        Group {
            switch state {
            case .empty:
                SmallMessage(symbol: "syringe", title: "Open Pepito+", caption: "to show your doses")
            case .paused(let until):
                SmallMessage(symbol: "pause.circle.fill", title: "Paused", caption: until)
            case .allLogged(let next):
                VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: standBy ? 56 : 44, weight: .semibold))
                        .foregroundStyle(ink.accent)
                        .pepitoAccentable()
                    Spacer(minLength: 0)
                    Text("All logged").font(WT.titleFont()).foregroundStyle(.primary)
                    if let next, !standBy {
                        Text("Next \(next)").font(WT.captionFont()).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityElement(children: .combine)
            case .due(let slot, let count, let first, _):
                due(slot: slot, count: count, row: first, ink: ink)
            }
        }
        .foregroundStyle(ink.base)
    }

    private func hero(_ row: DoseBoard.Row) -> (String, String?) {
        if row.isGroup { return (WatchHome.doseLine(row), "Draw together") }
        let i = row.items.first
        return (i?.dose ?? "", i?.units)
    }

    private func due(slot: Snapshot.Slot, count: Int, row: DoseBoard.Row, ink: Ink) -> some View {
        let (dose, under) = hero(row)
        return VStack(alignment: .leading, spacing: 0) {
            if !standBy {
                Text("\(slot.rawValue) · \(count) due")
                    .font(WT.captionFont())
                    .foregroundStyle(.secondary)
            }
            ViewThatFits(in: .horizontal) {
                Text(WidgetText.names(row)).lineLimit(1)
                Text("\(row.items.first?.name ?? "") +\(max(0, row.items.count - 1))").lineLimit(1)
            }
            .font(WT.titleFont())
            .foregroundStyle(.primary)
            .padding(.top, standBy ? 0 : PepitoTheme.Space.s4)
            .invalidatableContent()
            Text(dose)
                .font(PepitoTheme.number(standBy ? WT.heroStandBy : WT.hero))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .invalidatableContent()
            if let under, !standBy {
                Text(under).font(WT.captionFont()).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: PepitoTheme.Space.s4)
            actions.tick(row.id, AnyView(
                CapsuleLabel(title: row.verb, symbol: "checkmark", fill: ink.buttonFill, label: ink.buttonLabel)
                    .pepitoAccentable()
            ))
            .accessibilityLabel(row.speech)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// A small widget's quiet state: a symbol, one title line, one caption line.
struct SmallMessage: View {
    let symbol: String
    let title: String
    let caption: String?
    @Environment(\.isStandBy) private var standBy

    var body: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
            Image(systemName: symbol)
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: standBy ? 40 : 28, weight: .semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Text(title).font(WT.titleFont()).foregroundStyle(.primary).lineLimit(1)
            if let caption, !standBy {
                Text(caption).font(WT.captionFont()).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Today (medium)

/// The slot at a glance: a ring of logged over due on the left, up to three
/// rows on the right, each with its own tick. A group is one row: its names
/// stacked under "Draw together", one tick for the whole draw.
public struct TodayMediumView: View {
    let state: DoseWidgetState
    @Environment(\.surfaceMode) private var mode

    public init(state: DoseWidgetState) { self.state = state }

    static let singleHeight: CGFloat = 44
    static let groupHeight: CGFloat = 60
    static let moreHeight: CGFloat = 18
    static let budget: CGFloat = 138

    /// Rows that fit, due first, then how many are left over.
    static func fit(_ rows: [DoseBoard.Row]) -> (shown: [DoseBoard.Row], more: Int) {
        let ordered = rows.filter { $0.status == .due } + rows.filter { $0.status != .due }
        var used: CGFloat = 0
        var shown: [DoseBoard.Row] = []
        for (k, r) in ordered.enumerated() {
            let h = r.isGroup ? groupHeight : singleHeight
            let restAfter = ordered.count - k - 1
            let reserve = restAfter > 0 ? moreHeight : 0
            guard shown.count < 3, used + h + reserve <= budget else { break }
            shown.append(r)
            used += h
        }
        return (shown, ordered.count - shown.count)
    }

    public var body: some View {
        let ink = Ink(mode: mode)
        HStack(alignment: .center, spacing: PepitoTheme.Space.s16) {
            ring(ink: ink)
                .frame(width: 96)
            content(ink: ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .foregroundStyle(ink.base)
    }

    private var counts: (logged: Int, total: Int, slot: String) {
        switch state {
        case .due(let slot, let due, _, let rows): return (rows.count - due, rows.count, slot.title)
        case .allLogged: return (1, 1, "Today")
        case .paused: return (0, 0, "Paused")
        case .empty: return (0, 0, "Today")
        }
    }

    private func ring(ink: Ink) -> some View {
        let c = counts
        let label: String = {
            switch state {
            case .due: return "\(c.logged)/\(c.total)"
            case .allLogged: return ""
            default: return "–"
            }
        }()
        return VStack(spacing: PepitoTheme.Space.s8) {
            Gauge(value: Double(c.logged), in: 0...Double(max(c.total, 1))) {
                EmptyView()
            } currentValueLabel: {
                if case .allLogged = state {
                    Image(systemName: "checkmark")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(ink.accent)
                        .pepitoAccentable()
                } else {
                    Text(label)
                        .font(PepitoTheme.number(22))
                        .foregroundStyle(.primary)
                        .contentTransition(.numericText())
                        .invalidatableContent()
                }
            }
            .gaugeStyle(RingGaugeStyle(lineWidth: 8, tint: ink.accent, track: ink.track))
            .pepitoAccentable()
            .frame(width: 80, height: 80)
            Text(c.slot).font(WT.captionFont()).foregroundStyle(.secondary).lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(c.total > 0 ? "\(c.logged) of \(c.total) logged" : c.slot)
    }

    @ViewBuilder
    private func content(ink: Ink) -> some View {
        switch state {
        case .empty:
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                Text("Open Pepito+").font(WT.titleFont())
                Text("to show today's doses").font(WT.captionFont()).foregroundStyle(.secondary)
            }
        case .paused(let until):
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                Label("Protocol paused", systemImage: "pause.circle.fill").font(WT.titleFont())
                if let until { Text(until).font(WT.captionFont()).foregroundStyle(.secondary) }
            }
        case .allLogged(let next):
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                Text("All logged").font(WT.titleFont())
                if let next { Text("Next \(next)").font(WT.captionFont()).foregroundStyle(.secondary) }
            }
        case .due(_, _, _, let rows):
            let fit = TodayMediumView.fit(rows)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(fit.shown) { row in TodayRow(row: row, ink: ink) }
                if fit.more > 0 {
                    Text("+\(fit.more) more")
                        .font(WT.captionFont())
                        .foregroundStyle(.secondary)
                        .frame(height: TodayMediumView.moreHeight, alignment: .leading)
                }
            }
        }
    }
}

struct TodayRow: View {
    let row: DoseBoard.Row
    let ink: Ink
    @Environment(\.widgetActions) private var actions

    var body: some View {
        let done = row.status != .due
        let line = actions.tick(row.id, AnyView(
            HStack(alignment: .center, spacing: PepitoTheme.Space.s8) {
                names(done: done)
                Spacer(minLength: PepitoTheme.Space.s4)
                Text(detail)
                    .font(WT.captionFont())
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .layoutPriority(1)
                tick(done: done)
            }
            .frame(height: row.isGroup ? TodayMediumView.groupHeight : TodayMediumView.singleHeight)
            .contentShape(Rectangle())
        ))
        return line
            .disabled(done)
            .accessibilityLabel(done ? "\(row.title), done" : row.speech)
    }

    /// "3 mg · 30u", "1 spray", or a group's total units.
    private var detail: String {
        if row.isGroup { return WatchHome.doseLine(row) }
        guard let i = row.items.first else { return "" }
        return [i.dose, WidgetText.shortUnits(i.units)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    @ViewBuilder
    private func names(done: Bool) -> some View {
        if row.isGroup {
            VStack(alignment: .leading, spacing: 0) {
                Text("Draw together").font(WT.captionFont()).foregroundStyle(.secondary)
                ForEach(row.items) { i in
                    Text(i.name).font(WT.titleFont()).lineLimit(1)
                }
            }
            .foregroundStyle(done ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
            .invalidatableContent()
        } else {
            Text(row.items.first?.name ?? row.title)
                .font(WT.titleFont())
                .lineLimit(1)
                .foregroundStyle(done ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                .invalidatableContent()
        }
    }

    private func tick(done: Bool) -> some View {
        Image(systemName: done ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 28, weight: done ? .semibold : .regular))
            .foregroundStyle(done ? ink.accent : Color.white.opacity(0.45))
            .frame(width: 28, height: 28)
            .pepitoAccentable()
            .invalidatableContent()
    }
}

// MARK: - Lock Screen

/// Lock Screen rectangular: the next dose with its units, and its time.
public struct NextDoseRectangularView: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        let next = snap.flatMap { DoseBoard.next($0, now: now) }
        VStack(alignment: .leading, spacing: 0) {
            if let s = snap, s.paused.active, s.paused.wholeProtocol {
                Label("Paused", systemImage: "pause.circle.fill").font(.headline)
                Text(WidgetText.until(s.paused.until) ?? "Protocol paused").font(.subheadline).foregroundStyle(.secondary)
            } else if let next, let s = snap, let first = firstDue(s, next) {
                Label {
                    Text(WidgetText.clockFull(next.time))
                } icon: {
                    Image(systemName: "syringe.fill")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                Text(line(first))
                    .font(.headline)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .pepitoAccentable()
                if next.count > 1 {
                    Text("+\(next.count - 1) more").font(.subheadline).foregroundStyle(.secondary)
                }
            } else {
                Label("All logged", systemImage: "checkmark.circle.fill").font(.headline).pepitoAccentable()
                Text(snap == nil ? "Open Pepito+" : "Nothing else due").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func firstDue(_ s: Snapshot, _ n: Snapshot.NextDose) -> Snapshot.Item? {
        s.day(n.date)?.items.first { $0.slot == n.slot && $0.status == .due }
    }

    /// "Reta 3 mg · 30u"
    private func line(_ i: Snapshot.Item) -> String {
        ["\(i.name) \(i.dose)", WidgetText.shortUnits(i.units)].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Lock Screen inline: "Next: Reta 8 pm".
public struct NextDoseInlineContent: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        if let s = snap, s.paused.active, s.paused.wholeProtocol {
            Label("Protocol paused", systemImage: "pause.circle")
        } else if let s = snap, let next = DoseBoard.next(s, now: now),
                  let first = s.day(next.date)?.items.first(where: { $0.slot == next.slot && $0.status == .due }) {
            Label("Next: \(first.name) \(DoseBoard.clockLabel(next.time))", systemImage: "syringe")
        } else {
            Label(snap == nil ? "Pepito+" : "All logged", systemImage: "checkmark.circle")
        }
    }
}
#endif
