#if os(iOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

// MARK: - Readiness (small)

/// Today's readiness: a ring in the band's colour with the score as the hero,
/// the band, and HRV and resting heart rate against usual.
public struct ReadinessSmallView: View {
    let readiness: Snapshot.Readiness?
    let stale: Date?
    @Environment(\.surfaceMode) private var mode
    @Environment(\.snapshotTint) private var tint
    @Environment(\.isStandBy) private var standBy

    /// `stale` is the "as of" moment, passed only when the reading is old.
    public init(readiness: Snapshot.Readiness?, stale: Date? = nil) { self.readiness = readiness; self.stale = stale }

    public var body: some View {
        let ink = Ink(mode: mode, tint: tint)
        let score = readiness?.score
        let ringSize: CGFloat = standBy ? 112 : 84
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
            Gauge(value: Double(score ?? 0), in: 0...100) {
                EmptyView()
            } currentValueLabel: {
                Text(score.map(String.init) ?? "–")
                    .font(PepitoTheme.number(standBy ? WT.heroStandBy : WT.hero))
                    .foregroundStyle(.primary)
                    .contentTransition(.numericText())
            }
            .gaugeStyle(RingGaugeStyle(lineWidth: standBy ? 10 : 8, tint: ink.band(readiness?.band), track: ink.track))
            .pepitoAccentable()
            .frame(width: ringSize, height: ringSize)
            Spacer(minLength: 0)
            Text(bandLine).font(WT.titleFont()).foregroundStyle(.primary).lineLimit(1)
            if !standBy, let foot = footer {
                Text(foot)
                    .font(WT.captionFont())
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
        .foregroundStyle(ink.base)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }

    private var bandLine: String {
        guard let r = readiness else { return "No readiness yet" }
        if r.score != nil { return r.bandLabel ?? "Readiness" }
        return r.status == "building" ? "Building baseline" : "Not enough data"
    }

    static func arrow(_ d: Double?) -> String {
        guard let d, abs(d) >= 1 else { return "" }
        return d > 0 ? " ↑" : " ↓"
    }

    private var footer: String? {
        if let stale { return "as of \(stale.formatted(date: .omitted, time: .shortened).lowercased())" }
        guard let r = readiness else { return "Connect Apple Health" }
        var parts: [String] = []
        if let h = r.hrv { parts.append("HRV \(Int(h.rounded()))\(Self.arrow(r.hrvDelta))") }
        if let h = r.rhr { parts.append("RHR \(Int(h.rounded()))\(Self.arrow(r.rhrDelta))") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var spoken: String {
        guard let s = readiness?.score else { return "Readiness, \(bandLine)" }
        return "Readiness \(s), \(readiness?.bandLabel ?? "")"
    }
}

/// Lock Screen circular: readiness, or the sauna ring while a session runs.
public struct ReadinessCircularView: View {
    let snap: Snapshot?
    public init(snap: Snapshot?) { self.snap = snap }

    public var body: some View {
        if let a = snap?.sauna.active {
            ZStack {
                TimerRing(range: a.startDate...a.targetDate, tint: .white, track: .white.opacity(0.25), lineWidth: 6)
                    .pepitoAccentable()
                Image(systemName: "flame.fill").font(.system(size: 20, weight: .semibold))
            }
            .padding(2)
            .accessibilityLabel("Sauna running, target \(a.targetMin) minutes")
        } else {
            let r = snap?.readiness
            Gauge(value: Double(r?.score ?? 0), in: 0...100) {
                Image(systemName: "heart.fill")
            } currentValueLabel: {
                Text(r?.score.map(String.init) ?? "–").font(PepitoTheme.number(20)).contentTransition(.numericText())
            }
            .gaugeStyle(.accessoryCircular)
            .pepitoAccentable()
            .accessibilityLabel(r?.score.map { "Readiness \($0), \(r?.bandLabel ?? "")" } ?? "Readiness not available")
        }
    }
}

// MARK: - Sauna (small)

/// Idle: this week against the target, with a dot for each session, and
/// Start. Running: the elapsed time as the hero, a ring to the target, the
/// temperature, and Stop.
public struct SaunaSmallView: View {
    let sauna: Snapshot.Sauna?
    @Environment(\.surfaceMode) private var mode
    @Environment(\.snapshotTint) private var tint
    @Environment(\.isStandBy) private var standBy
    @Environment(\.widgetActions) private var actions

    public init(sauna: Snapshot.Sauna?) { self.sauna = sauna }

    public var body: some View {
        let ink = Ink(mode: mode, tint: tint)
        Group {
            if let s = sauna {
                if let a = s.active { running(a, ink: ink) } else { idle(s, ink: ink) }
            } else {
                SmallMessage(symbol: "flame.fill", title: "Open Pepito+", caption: "to start a session")
            }
        }
        .foregroundStyle(ink.base)
    }

    private func idle(_ s: Snapshot.Sauna, ink: Ink) -> some View {
        let w = s.week
        let met = w.target > 0 && w.sessions >= w.target
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s4) {
                Image(systemName: "flame.fill")
                    .symbolRenderingMode(.hierarchical)
                    .font(.system(size: WT.title, weight: .semibold))
                    .foregroundStyle(ink.sauna)
                if !standBy { Text("This week").font(WT.captionFont()).foregroundStyle(.secondary) }
            }
            HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s4) {
                Text("\(w.sessions)")
                    .font(PepitoTheme.number(standBy ? WT.heroStandBy : WT.hero))
                    .contentTransition(.numericText())
                Text("of \(w.target)").font(WT.titleFont()).foregroundStyle(.secondary)
            }
            .padding(.top, PepitoTheme.Space.s4)
            dots(sessions: w.sessions, target: w.target, ink: ink, met: met)
                .padding(.top, PepitoTheme.Space.s4)
            Spacer(minLength: PepitoTheme.Space.s4)
            actions.startSauna(AnyView(
                CapsuleLabel(title: "Start", symbol: "flame.fill", fill: ink.buttonFill, label: ink.buttonLabel)
                    .pepitoAccentable()
            ))
            .accessibilityLabel("Start sauna, \(s.usual.lengthMin) minutes at \(s.usual.tempC) degrees")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
    }

    private func dots(sessions: Int, target: Int, ink: Ink, met: Bool) -> some View {
        let n = max(1, min(target, 7))
        return HStack(spacing: PepitoTheme.Space.s4) {
            ForEach(0..<n, id: \.self) { k in
                Capsule()
                    .fill(k < sessions ? ink.accent : ink.track)
                    .frame(height: 6)
                    .frame(maxWidth: 24)
            }
        }
        .pepitoAccentable()
        .accessibilityHidden(true)
    }

    private func running(_ a: Snapshot.Sauna.Active, ink: Ink) -> some View {
        let autoEnd = a.startDate.addingTimeInterval(SaunaLimits.autoEndAfter)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: PepitoTheme.Space.s8) {
                TimerRing(range: a.startDate...a.targetDate, tint: ink.accent, track: ink.track, lineWidth: 4)
                    .frame(width: 24, height: 24)
                    .pepitoAccentable()
                if !standBy {
                    Text("\(a.tempC)° · \(a.targetMin) min").font(WT.captionFont()).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            Text(timerInterval: a.startDate...autoEnd, countsDown: false)
                .font(PepitoTheme.number(standBy ? WT.heroStandBy : WT.hero))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.top, PepitoTheme.Space.s8)
            Spacer(minLength: PepitoTheme.Space.s4)
            actions.stopSauna(AnyView(
                CapsuleLabel(title: "Stop", symbol: "stop.fill", fill: ink.neutralFill, label: ink.neutralLabel)
            ))
            .accessibilityLabel("Stop sauna")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
#endif
