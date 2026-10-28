#if os(watchOS)
import SwiftUI
import PepitoCore
import PepitoTheme

// MARK: - Home

/// Four large tiles, always in this order: Doses, Sauna, Readiness, Sleep. Each has
/// its symbol, its title and one live line. One tap opens the screen.
public struct WatchHomeContent: View {
    let snap: Snapshot?
    let now: Date
    let night: SleepMode.Night?
    let open: (WatchRoute) -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    public init(snap: Snapshot?, now: Date, night: SleepMode.Night? = nil, open: @escaping (WatchRoute) -> Void) {
        self.snap = snap; self.now = now; self.night = night; self.open = open
    }

    public var body: some View {
        let doses = WatchHome.doses(snap, now: now)
        let sauna = WatchHome.sauna(snap)
        VStack(spacing: PepitoTheme.Space.s8) {
            tile(.doses, symbol: "syringe.fill", title: "Doses",
                 line: Text(doses.text).foregroundStyle(doses.done ? Pal.accent : Pal.text2),
                 short: Text(doses.short).foregroundStyle(doses.done ? Pal.accent : Pal.text2))
            tile(.sauna, symbol: "flame.fill", title: "Sauna",
                 line: Text(sauna.text).foregroundStyle(sauna.text == "Running" ? Pal.sauna : Pal.text2),
                 short: Text(sauna.short).foregroundStyle(sauna.text == "Running" ? Pal.sauna : Pal.text2))
            tile(.readiness, symbol: "heart.fill", title: "Readiness", line: readinessLine, short: readinessShort)
            let sleep = SleepMode.tileLine(phase: SleepMode.phase(now: now, night: night), lastNight: snap?.sleep?.lastNight, now: now)
            tile(.sleep, symbol: "moon.fill", title: "Sleep",
                 line: Text(sleep.text).foregroundStyle(Pal.text2), short: Text(sleep.short).foregroundStyle(Pal.text2))
        }
        .opacity(dimmed ? 0.6 : 1)
    }

    private var readinessShort: Text {
        guard let score = snap?.readiness?.score else { return Text(snap?.readiness == nil ? "No data" : "Building").foregroundStyle(Pal.text2) }
        return Text("\(score)").font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(PepitoTheme.bandColor(snap?.readiness?.band))
    }

    private var readinessLine: Text {
        guard let r = snap?.readiness else { return Text("Connect Health").foregroundStyle(Pal.text2) }
        guard let score = r.score else {
            return Text(r.status == "building" ? "Building baseline" : "Not enough data").foregroundStyle(Pal.text2)
        }
        return Text("\(score)").font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(PepitoTheme.bandColor(r.band))
            + Text(" \(r.bandLabel ?? "")").foregroundStyle(Pal.text2)
    }

    private func tile(_ route: WatchRoute, symbol: String, title: String, line: Text, short: Text) -> some View {
        Button { open(route) } label: {
            HStack(spacing: PepitoTheme.Space.s8) {
                Image(systemName: symbol)
                    .symbolRenderingMode(.hierarchical)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Pal.text)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text)
                    ViewThatFits(in: .horizontal) {
                        line.fixedSize()
                        short.fixedSize()
                    }
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()
                }
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(WatchTileStyle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Readiness

/// The score in a ring of the band's colour, the band, then HRV, resting
/// heart rate and sleep, each against usual where there is a usual.
public struct WatchReadinessContent: View {
    let readiness: Snapshot.Readiness?
    let asOf: Date?
    @Environment(\.watchMetrics) private var m
    @Environment(\.isLuminanceReduced) private var dimmed

    /// `asOf` only when the reading is more than six hours old.
    public init(readiness: Snapshot.Readiness?, asOf: Date?) { self.readiness = readiness; self.asOf = asOf }

    public var body: some View {
        let r = readiness
        VStack(spacing: PepitoTheme.Space.s12) {
            Gauge(value: Double(r?.score ?? 0), in: 0...100) {
                EmptyView()
            } currentValueLabel: {
                Text(r?.score.map(String.init) ?? "–")
                    .font(PepitoTheme.number(m.isSmall ? 36 : 40))
                    .foregroundStyle(Pal.text)
                    .contentTransition(.numericText())
            }
            .gaugeStyle(RingGaugeStyle(lineWidth: m.isSmall ? 9 : 10,
                                       tint: dimmed ? PepitoTheme.bandColor(r?.band).opacity(0.5) : PepitoTheme.bandColor(r?.band)))
            .frame(width: m.ring, height: m.ring)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(r?.score.map { "Readiness \($0), \(r?.bandLabel ?? "")" } ?? "Readiness, \(bandLine)")
            Text(bandLine)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(r?.score == nil ? Pal.text2 : PepitoTheme.bandColor(r?.band))
                .padding(.top, -PepitoTheme.Space.s4)
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                if let r {
                    row("HRV", value: r.hrv.map { "\(Int($0.rounded())) ms" }, delta: r.hrvDelta)
                    row("Resting HR", value: r.rhr.map { "\(Int($0.rounded())) bpm" }, delta: r.rhrDelta)
                    row("Sleep", value: r.sleepMin.map { "\(Int($0) / 60) h \(Int($0) % 60) min" }, delta: nil)
                } else {
                    Text("Connect Apple Health in Pepito+ on your iPhone.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Pal.text2)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let asOf {
                Text("as of \(Clock.time(asOf))")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Pal.text2)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var bandLine: String {
        guard let r = readiness else { return "No data" }
        if r.score != nil { return r.bandLabel ?? "" }
        return r.status == "building" ? "Building baseline" : "Not enough data"
    }

    private func row(_ label: String, value: String?, delta: Double?) -> some View {
        HStack(spacing: PepitoTheme.Space.s4) {
            Text(label).font(.system(size: 15, weight: .medium)).foregroundStyle(Pal.text2)
            Spacer(minLength: 0)
            Text(value ?? "–").font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(Pal.text)
            Image(systemName: arrow(delta))
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Pal.text2)
                .frame(width: 12)
                .opacity(delta.map { abs($0) >= 1 } ?? false ? 1 : 0)
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) \(value ?? "not available")\(delta.map { abs($0) >= 1 ? ($0 > 0 ? ", above usual" : ", below usual") : "" } ?? "")")
    }

    private func arrow(_ d: Double?) -> String { (d ?? 0) >= 0 ? "arrow.up" : "arrow.down" }
}
#endif
