#if os(watchOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

// Complications and Smart Stack widgets. Each opens its own screen.

/// accessoryCircular: the readiness score in a gauge, in the band colour on full-colour faces.
public struct ReadinessComplication: View {
    let readiness: Snapshot.Readiness?
    @Environment(\.surfaceMode) private var mode
    public init(readiness: Snapshot.Readiness?) { self.readiness = readiness }

    public var body: some View {
        Gauge(value: Double(readiness?.score ?? 0), in: 0...100) {
            Image(systemName: "heart.fill")
        } currentValueLabel: {
            Text(readiness?.score.map(String.init) ?? "–").font(PepitoTheme.number(18, weight: .semibold))
        }
        .gaugeStyle(.accessoryCircular)
        .tint(mode.isColor ? PepitoTheme.bandColor(readiness?.band) : .white)
        .pepitoAccentable()
        .accessibilityLabel(readiness?.score.map { "Readiness \($0), \(readiness?.bandLabel ?? "")" } ?? "Readiness not available")
    }
}

/// accessoryCircular: the sauna, a flame, or a ring to the target while it runs.
public struct SaunaCircularComplication: View {
    let sauna: Snapshot.Sauna?
    @Environment(\.surfaceMode) private var mode
    public init(sauna: Snapshot.Sauna?) { self.sauna = sauna }

    public var body: some View {
        if let a = sauna?.active {
            ProgressView(timerInterval: a.startDate...a.targetDate, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                Image(systemName: "flame.fill")
            }
            .progressViewStyle(.circular)
            .tint(mode.isColor ? Pal.sauna : .white)
            .pepitoAccentable()
            .accessibilityLabel("Sauna running")
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "flame.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(mode.isColor ? Pal.sauna : .white)
                    .pepitoAccentable()
            }
            .accessibilityLabel("Start sauna")
        }
    }
}

/// accessoryCorner (Ultra faces and others): the flame, with this week or the
/// elapsed time curved along the corner.
public struct SaunaCornerComplication: View {
    let sauna: Snapshot.Sauna?
    @Environment(\.surfaceMode) private var mode
    public init(sauna: Snapshot.Sauna?) { self.sauna = sauna }

    public var body: some View {
        Image(systemName: "flame.fill")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(mode.isColor ? Pal.sauna : .white)
            .pepitoAccentable()
            .widgetLabel {
                if let a = sauna?.active {
                    ProgressView(timerInterval: a.startDate...a.targetDate, countsDown: false)
                        .tint(mode.isColor ? Pal.sauna : .white)
                } else if let w = sauna?.week {
                    Text("\(w.sessions) of \(w.target)")
                } else {
                    Text("Sauna")
                }
            }
            .accessibilityLabel(sauna?.active != nil ? "Sauna running" : sauna.map { "Sauna, \($0.week.sessions) of \($0.week.target) this week" } ?? "Sauna")
    }
}

/// accessoryRectangular (and the Smart Stack): the next dose.
public struct NextDoseComplication: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        let next = snap.flatMap { DoseBoard.next($0, now: now) }
        let first = next.flatMap { n in snap?.day(n.date)?.items.first { $0.slot == n.slot && $0.status == .due } }
        VStack(alignment: .leading, spacing: 0) {
            if let s = snap, s.paused.active, s.paused.wholeProtocol {
                Label("Paused", systemImage: "pause.circle.fill").font(.headline).pepitoAccentable()
                Text("Protocol paused").font(.subheadline).foregroundStyle(.secondary)
            } else if let next, let first {
                Text("\(next.slot.rawValue) · \(DoseBoard.clockLabel(next.time))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("\(first.name) \(first.dose)")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .pepitoAccentable()
                Text([first.units, next.count > 1 ? "+\(next.count - 1) more" : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Label("All logged", systemImage: "checkmark.circle.fill").font(.headline).pepitoAccentable()
                Text(snap == nil ? "Open Pepito+ on iPhone" : "Nothing else due").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// accessoryInline: "Reta 3 mg · 8 pm".
public struct NextDoseInlineComplication: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        if let s = snap, s.paused.active, s.paused.wholeProtocol {
            Label("Paused", systemImage: "pause.circle")
        } else if let s = snap, let n = DoseBoard.next(s, now: now),
                  let first = s.day(n.date)?.items.first(where: { $0.slot == n.slot && $0.status == .due }) {
            Label("\(first.name) \(first.dose) · \(DoseBoard.clockLabel(n.time))", systemImage: "syringe")
        } else {
            Label(snap == nil ? "Pepito+" : "All logged", systemImage: "checkmark.circle")
        }
    }
}
#endif
