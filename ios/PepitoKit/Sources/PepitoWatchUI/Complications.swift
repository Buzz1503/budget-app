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

/// accessoryRectangular (and the Smart Stack): readiness, its band, sleep and HRV.
public struct ReadinessRectangular: View {
    let readiness: Snapshot.Readiness?
    public init(readiness: Snapshot.Readiness?) { self.readiness = readiness }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Readiness").font(.subheadline).foregroundStyle(.secondary)
            if let r = readiness, let score = r.score {
                Text("\(score) · \(r.bandLabel ?? "")").font(.headline).monospacedDigit().lineLimit(1).pepitoAccentable()
                Text([r.sleepMin.map { "Sleep \(Int($0) / 60) h \(Int($0) % 60) m" }, r.hrv.map { "HRV \(Int($0.rounded())) ms" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            } else {
                Text("Not yet today").font(.headline)
                Text("Open Pepito+ on iPhone").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// accessoryRectangular (and the Smart Stack): the sauna week, or the session running.
public struct SaunaRectangular: View {
    let sauna: Snapshot.Sauna?
    public init(sauna: Snapshot.Sauna?) { self.sauna = sauna }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Sauna", systemImage: "flame.fill").font(.subheadline).foregroundStyle(.secondary)
            if let a = sauna?.active {
                Text(timerInterval: a.startDate...a.targetDate, countsDown: false).font(.headline).monospacedDigit().pepitoAccentable()
                Text("\(a.tempC) C · round \(a.rounds)").font(.subheadline).foregroundStyle(.secondary)
            } else if let w = sauna?.week {
                Text("\(w.sessions) of \(w.target) this week").font(.headline).monospacedDigit().pepitoAccentable()
                Text("\(w.heatMin) min of heat").font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
            } else {
                Text("Start a session").font(.headline)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// accessoryRectangular (and the Smart Stack): the next dose.
public struct NextDoseComplication: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        let next = snap.flatMap { DoseBoard.nextRow($0, now: now) }
        VStack(alignment: .leading, spacing: 0) {
            if let s = snap, s.paused.active, s.paused.wholeProtocol {
                Label("Paused", systemImage: "pause.circle.fill").font(.headline).pepitoAccentable()
                Text("Protocol paused").font(.subheadline).foregroundStyle(.secondary)
            } else if let next, let s = snap {
                Text("\(next.slot.rawValue) · \(WatchHome.slotTime(s, date: next.date, slot: next.slot, now: now))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(next.row.isGroup ? next.row.items.map(\.name).joined(separator: " + ") : "\(next.row.items.first?.name ?? "") \(next.row.items.first?.dose ?? "")")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .pepitoAccentable()
                Text([next.row.isGroup ? WatchHome.doseLine(next.row) : next.row.items.first?.units,
                      next.dueRows > 1 ? "+\(next.dueRows - 1) more" : nil].compactMap { $0 }.joined(separator: " · "))
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

/// accessoryInline: "Reta · 8 pm".
public struct NextDoseInlineComplication: View {
    let snap: Snapshot?
    let now: Date
    public init(snap: Snapshot?, now: Date) { self.snap = snap; self.now = now }

    public var body: some View {
        if let s = snap, s.paused.active, s.paused.wholeProtocol {
            Label("Paused", systemImage: "pause.circle")
        } else if let s = snap, let n = DoseBoard.nextRow(s, now: now) {
            let name = n.row.items.first?.name ?? n.row.title
            Label("\(name)\(n.row.isGroup ? " +\(n.row.items.count - 1)" : "") · \(DoseBoard.clockLabel(n.time))", systemImage: "syringe")
        } else {
            Label(snap == nil ? "Pepito+" : "All logged", systemImage: "checkmark.circle")
        }
    }
}
#endif
