#if os(watchOS)
import SwiftUI
import PepitoCore
import PepitoTheme

// MARK: - Start

/// The temperature as the hero, turned with the Digital Crown in 1° steps,
/// then Start, then the target length, which opens its own picker.
public struct WatchSaunaStartContent: View {
    let tempC: Int
    let targetMin: Int
    let onStart: () -> Void
    let onTarget: () -> Void
    @Environment(\.watchMetrics) private var m

    public init(tempC: Int, targetMin: Int, onStart: @escaping () -> Void, onTarget: @escaping () -> Void) {
        self.tempC = tempC; self.targetMin = targetMin; self.onStart = onStart; self.onTarget = onTarget
    }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            VStack(spacing: 0) {
                Text("\(tempC)°")
                    .font(PepitoTheme.number(m.hero))
                    .foregroundStyle(Pal.text)
                    .contentTransition(.numericText(value: Double(tempC)))
                Text("Turn the Crown to set")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Pal.text2)
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Temperature \(tempC) degrees")
            .accessibilityValue("\(tempC)")
            Button(action: onStart) {
                Label("Start", systemImage: "flame.fill")
            }
            .buttonStyle(WatchPrimaryButtonStyle())
            .pepitoPrimaryGesture()
            .accessibilityLabel("Start sauna, \(targetMin) minutes at \(tempC) degrees")
            Button(action: onTarget) {
                HStack {
                    Text("Target").foregroundStyle(Pal.text2)
                    Spacer(minLength: 0)
                    Text("\(targetMin) min").font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(Pal.text)
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Pal.text2)
                }
                .font(.system(size: 15, weight: .medium))
                .padding(.horizontal, PepitoTheme.Space.s12)
            }
            .buttonStyle(WatchSecondaryButtonStyle(height: 44))
            .accessibilityLabel("Target \(targetMin) minutes")
        }
    }
}

/// Target length: the minutes as the hero, on the Crown.
public struct WatchTargetContent: View {
    let minutes: Int
    let onDone: () -> Void
    @Environment(\.watchMetrics) private var m
    public init(minutes: Int, onDone: @escaping () -> Void) { self.minutes = minutes; self.onDone = onDone }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s4) {
                Text("\(minutes)")
                    .font(PepitoTheme.number(m.hero))
                    .contentTransition(.numericText(value: Double(minutes)))
                Text("min").font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text2)
            }
            .foregroundStyle(Pal.text)
            .accessibilityElement(children: .combine)
            Text("Turn the Crown to set").font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
            Spacer(minLength: 0)
            Button("Done", action: onDone).buttonStyle(WatchPrimaryButtonStyle())
        }
    }
}

// MARK: - Running

/// Everything the running screen shows at one moment.
public struct SaunaRunState: Equatable {
    public var startedAt: Date
    public var targetMin: Int
    public var tempC: Int
    public var rounds: Int
    public var heartRate: Double?
    public var maxHR: Int
    public var floors: [Double]
    /// The last ten minutes of heart rate, oldest first.
    public var recent: [SaunaHeartRate.Sample]
    public var pausedSec: Double
    public var pausedAt: Date?

    public init(startedAt: Date, targetMin: Int, tempC: Int, rounds: Int, heartRate: Double?, maxHR: Int, floors: [Double],
                recent: [SaunaHeartRate.Sample], pausedSec: Double = 0, pausedAt: Date? = nil) {
        self.startedAt = startedAt; self.targetMin = targetMin; self.tempC = tempC; self.rounds = rounds
        self.heartRate = heartRate; self.maxHR = maxHR; self.floors = floors; self.recent = recent
        self.pausedSec = pausedSec; self.pausedAt = pausedAt
    }

    public func elapsed(at now: Date) -> TimeInterval {
        let end = pausedAt ?? now
        return max(0, end.timeIntervalSince(startedAt) - pausedSec)
    }
    public var target: TimeInterval { TimeInterval(targetMin * 60) }
    public var zonePosition: Double? {
        heartRate.map { SaunaHeartRate.zonePosition(bpm: $0, maxHR: maxHR, floors: floors) }
    }
    public var zone: Int? { heartRate.map { SaunaHeartRate.zone(bpm: $0, maxHR: maxHR, floors: floors) } }
}

/// A rounded rectangle path that starts at the top centre and runs
/// clockwise, so trimming it fills the screen edge like a clock hand.
struct EdgeRing: Shape {
    var cornerRadius: CGFloat
    func path(in r: CGRect) -> Path {
        let c = min(cornerRadius, min(r.width, r.height) / 2)
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
        p.addArc(center: CGPoint(x: r.maxX - c, y: r.minY + c), radius: c, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - c))
        p.addArc(center: CGPoint(x: r.maxX - c, y: r.maxY - c), radius: c, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX + c, y: r.maxY))
        p.addArc(center: CGPoint(x: r.minX + c, y: r.maxY - c), radius: c, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        p.addArc(center: CGPoint(x: r.minX + c, y: r.minY + c), radius: c, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

/// The timer and heart rate together: a thick ring round the screen edge
/// filling to the target in the colour of the heart-rate zone, the elapsed
/// time as the hero, the heart rate beating at its own rate with its zone,
/// and the last ten minutes as a line with its peak.
public struct WatchSaunaRunningContent: View {
    let state: SaunaRunState
    let now: Date
    @Environment(\.watchMetrics) private var m
    @Environment(\.isLuminanceReduced) private var dimmed

    public init(state: SaunaRunState, now: Date) { self.state = state; self.now = now }

    public var body: some View {
        let elapsed = state.elapsed(at: now)
        let fraction = state.target > 0 ? min(1, elapsed / state.target) : 0
        let reached = elapsed >= state.target
        let colour = PepitoTheme.zoneColor(state.zonePosition ?? 1)
        let ringWidth: CGFloat = m.isSmall ? 10 : 12
        ZStack {
            EdgeRing(cornerRadius: m.cornerRadius - ringWidth / 2)
                .stroke(Color.white.opacity(dimmed ? 0.08 : 0.14), lineWidth: ringWidth)
                .padding(ringWidth / 2)
            EdgeRing(cornerRadius: m.cornerRadius - ringWidth / 2)
                .trim(from: 0, to: max(0.002, fraction))
                .stroke(colour.opacity(dimmed ? 0.55 : 1), style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))
                .padding(ringWidth / 2)
                .animation(.easeInOut(duration: 0.8), value: state.zonePosition)
            VStack(spacing: PepitoTheme.Space.s4) {
                Text(Clock.elapsed(elapsed, seconds: !dimmed))
                    .font(PepitoTheme.number(dimmed ? m.timer * 0.8 : m.timer))
                    .foregroundStyle(reached || state.pausedAt != nil ? Pal.text2 : Pal.text)
                    .contentTransition(.numericText(countsDown: false))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel("\(Int(elapsed / 60)) of \(state.targetMin) minutes")
                Text(state.pausedAt != nil ? "Paused" : reached ? "Target reached" : "of \(state.targetMin) min · \(state.tempC)°")
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Pal.text2)
                heartRow(colour: colour)
                    .padding(.top, PepitoTheme.Space.s4)
                if !dimmed {
                    Sparkline(samples: state.recent, colour: colour)
                        .frame(height: m.isSmall ? 22 : 28)
                        .padding(.horizontal, PepitoTheme.Space.s8)
                }
            }
            .padding(.horizontal, ringWidth + PepitoTheme.Space.s12)
        }
    }

    private func heartRow(colour: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s4) {
            BeatingHeart(bpm: state.heartRate, colour: colour, still: dimmed || state.heartRate == nil)
            Text(state.heartRate.map { "\(Int($0.rounded()))" } ?? "--")
                .font(PepitoTheme.number(17, weight: .semibold))
                .foregroundStyle(Pal.text)
            Text(zoneWords)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Pal.text2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.heartRate.map { "Heart rate \(Int($0.rounded())), \(zoneWords)" } ?? "Heart rate not read yet")
    }

    private var zoneWords: String {
        guard let z = state.zone else { return "" }
        return z > 0 ? "Zone \(z)" : "Below zone 1"
    }
}

/// The heart symbol, beating at the heart rate. Still in Always On.
struct BeatingHeart: View {
    let bpm: Double?
    let colour: Color
    let still: Bool

    var body: some View {
        if still {
            heart(scale: 1)
        } else {
            TimelineView(.animation) { ctx in
                let period = 60 / max(30, min(220, bpm ?? 60))
                let phase = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
                // a quick swell and a slower fall, like a beat
                let s = phase < 0.18 ? 1 + 0.22 * (phase / 0.18) : 1 + 0.22 * max(0, 1 - (phase - 0.18) / 0.5)
                heart(scale: s)
            }
        }
    }

    private func heart(scale: Double) -> some View {
        Image(systemName: "heart.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(colour)
            .scaleEffect(scale)
    }
}

/// A line of heart rate with its highest point marked.
struct Sparkline: View {
    let samples: [SaunaHeartRate.Sample]
    let colour: Color

    var body: some View {
        GeometryReader { geo in
            let pts = points(in: geo.size)
            ZStack(alignment: .topLeading) {
                Path { p in
                    guard let first = pts.first else { return }
                    p.move(to: first)
                    for q in pts.dropFirst() { p.addLine(to: q) }
                }
                .stroke(colour, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let peak = peakIndex, peak < pts.count {
                    Circle().fill(Pal.text).frame(width: 5, height: 5)
                        .position(pts[peak])
                }
            }
        }
        .accessibilityHidden(true)
    }

    private var peakIndex: Int? {
        samples.indices.max { samples[$0].bpm < samples[$1].bpm }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard samples.count > 1, let t0 = samples.first?.t, let t1 = samples.last?.t, t1 > t0 else { return [] }
        let lo = (samples.map(\.bpm).min() ?? 0) - 4
        let hi = (samples.map(\.bpm).max() ?? 1) + 4
        return samples.map { s in
            CGPoint(x: (s.t - t0) / (t1 - t0) * size.width,
                    y: size.height - (s.bpm - lo) / max(1, hi - lo) * size.height)
        }
    }
}

/// Swipe left from the running screen: Stop (asks first), Next round, Pause.
public struct WatchSaunaControlsContent: View {
    let paused: Bool
    let rounds: Int
    let onStop: () -> Void
    let onNextRound: () -> Void
    let onPause: () -> Void
    @Environment(\.watchMetrics) private var m

    public init(paused: Bool, rounds: Int, onStop: @escaping () -> Void, onNextRound: @escaping () -> Void, onPause: @escaping () -> Void) {
        self.paused = paused; self.rounds = rounds; self.onStop = onStop; self.onNextRound = onNextRound; self.onPause = onPause
    }

    public var body: some View {
        let size: CGFloat = m.isSmall ? 50 : 56
        VStack(spacing: PepitoTheme.Space.s16) {
            HStack(spacing: m.isSmall ? PepitoTheme.Space.s8 : PepitoTheme.Space.s12) {
                control("Stop", symbol: "xmark", tint: Pal.danger, size: size, action: onStop)
                control("Round \(rounds + 1)", symbol: "arrow.clockwise", tint: Pal.text, size: size, action: onNextRound)
                control(paused ? "Resume" : "Pause", symbol: paused ? "play.fill" : "pause.fill", tint: Pal.sauna, size: size, action: onPause)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func control(_ title: String, symbol: String, tint: Color, size: CGFloat, action: @escaping () -> Void) -> some View {
        VStack(spacing: PepitoTheme.Space.s4) {
            Button(action: action) {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.4, weight: .bold))
                    .foregroundStyle(tint)
                    .frame(width: size, height: size)
                    .background(Circle().fill(tint.opacity(0.2)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Pal.text2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Cool down

/// After Stop, when Cool down is on: the Watch keeps reading heart rate for
/// 5 minutes. The time left is the hero, then the heart rate now and how far
/// it has fallen since leaving, and Done to end early.
public struct WatchSaunaCoolDownContent: View {
    let exitAt: Date
    let now: Date
    let heartRate: Double?
    let exitHR: Double?
    let onDone: () -> Void
    @Environment(\.watchMetrics) private var m

    public init(exitAt: Date, now: Date, heartRate: Double?, exitHR: Double?, onDone: @escaping () -> Void) {
        self.exitAt = exitAt; self.now = now; self.heartRate = heartRate; self.exitHR = exitHR; self.onDone = onDone
    }

    public var body: some View {
        let left = max(0, SaunaHeartRate.coolDownSec - now.timeIntervalSince(exitAt))
        VStack(spacing: PepitoTheme.Space.s8) {
            VStack(spacing: 0) {
                Text("Cool down")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Pal.text2)
                Text(Clock.elapsed(left, seconds: true))
                    .font(PepitoTheme.number(m.timer))
                    .foregroundStyle(Pal.text)
                    .contentTransition(.numericText(countsDown: true))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Cool down, \(Int(left / 60)) minutes \(Int(left) % 60) seconds left")
            HStack(spacing: PepitoTheme.Space.s4) {
                Image(systemName: "heart.fill").foregroundStyle(Pal.sauna)
                Text(heartRate.map { "\(Int($0.rounded())) bpm" } ?? "Reading")
                    .font(PepitoTheme.number(15, weight: .semibold))
                    .foregroundStyle(Pal.text)
                if let hr = heartRate, let e = exitHR, e - hr >= 1 {
                    Text("\(Int((e - hr).rounded())) lower")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Pal.text2)
                }
            }
            .accessibilityElement(children: .combine)
            Button("Done", action: onDone)
                .buttonStyle(WatchPrimaryButtonStyle())
                .padding(.top, PepitoTheme.Space.s4)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Summary

public struct SaunaSummaryState: Equatable {
    public var start: Date
    public var end: Date
    public var tempC: Int
    public var rounds: Int
    public var avgHR: Int?
    public var peakHR: Int?
    public var zoneMinutes: [Double]
    public var samples: [SaunaHeartRate.Sample]
    public var activeSec: Double
    /// From the cool-down, when there was one.
    public var coolDown: SaunaHeartRate.CoolDownDrop?

    public init(start: Date, end: Date, tempC: Int, rounds: Int, avgHR: Int?, peakHR: Int?, zoneMinutes: [Double],
                samples: [SaunaHeartRate.Sample], activeSec: Double? = nil, coolDown: SaunaHeartRate.CoolDownDrop? = nil) {
        self.start = start; self.end = end; self.tempC = tempC; self.rounds = rounds; self.avgHR = avgHR
        self.peakHR = peakHR; self.zoneMinutes = zoneMinutes; self.samples = samples
        self.activeSec = activeSec ?? end.timeIntervalSince(start)
        self.coolDown = coolDown
    }
}

/// After Stop: the time as the hero, temperature, heart rate, minutes in
/// each zone as one bar, the heart rate over the session, rounds, and Done.
public struct WatchSaunaSummaryContent: View {
    let s: SaunaSummaryState
    let onDone: () -> Void
    @Environment(\.watchMetrics) private var m

    public init(summary: SaunaSummaryState, onDone: @escaping () -> Void) { self.s = summary; self.onDone = onDone }

    public var body: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: PepitoTheme.Space.s4) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Pal.accent)
                    Text("Saved to Health").foregroundStyle(Pal.text2)
                }
                .font(.system(size: 13, weight: .medium))
                Text(Clock.elapsed(s.activeSec, seconds: true))
                    .font(PepitoTheme.number(m.timer))
                    .foregroundStyle(Pal.text)
            }
            VStack(spacing: 0) {
                row("Temperature", "\(s.tempC)°C")
                row("Average HR", s.avgHR.map { "\($0) bpm" } ?? "–")
                row("Peak HR", s.peakHR.map { "\($0) bpm" } ?? "–")
                row("Rounds", "\(s.rounds)")
                if let d = s.coolDown?.drop2 { row("Drop at 2 min", "\(d) bpm") }
                if let d = s.coolDown?.drop5 { row("Drop at 5 min", "\(d) bpm") }
            }
            if s.zoneMinutes.reduce(0, +) > 0 {
                VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                    Text("Time in zones").font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                    ZoneBar(minutes: s.zoneMinutes)
                        .frame(height: 10)
                    ZoneLegend(minutes: s.zoneMinutes)
                }
            }
            if s.samples.count > 1 {
                VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                    Text("Heart rate").font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                    Sparkline(samples: s.samples, colour: PepitoTheme.zoneColor(3))
                        .frame(height: 44)
                }
            }
            Button("Done", action: onDone)
                .buttonStyle(WatchPrimaryButtonStyle())
                .padding(.top, PepitoTheme.Space.s4)
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 15, weight: .medium)).foregroundStyle(Pal.text2)
            Spacer(minLength: PepitoTheme.Space.s4)
            Text(value).font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(Pal.text)
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
    }
}

/// Minutes in zones 1 to 5 as one bar, each zone in its colour.
struct ZoneBar: View {
    let minutes: [Double]
    var body: some View {
        GeometryReader { geo in
            let total = max(0.0001, minutes.reduce(0, +))
            let shown = minutes.enumerated().filter { $0.element > 0 }
            let gaps = CGFloat(max(0, shown.count - 1)) * 2
            HStack(spacing: 2) {
                ForEach(shown, id: \.offset) { z, m in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(PepitoTheme.zoneSolid(z + 1))
                        .frame(width: max(3, (geo.size.width - gaps) * CGFloat(m / total)))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(minutes.enumerated().map { "zone \($0.offset + 1) \(Int($0.element.rounded())) minutes" }.joined(separator: ", "))
    }
}

struct ZoneLegend: View {
    let minutes: [Double]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(minutes.enumerated()), id: \.offset) { z, m in
                VStack(spacing: 0) {
                    Text("Z\(z + 1)").foregroundStyle(PepitoTheme.zoneSolid(z + 1))
                    Text("\(Int(m.rounded()))m").foregroundStyle(Pal.text2)
                }
                .font(PepitoTheme.number(13, weight: .semibold))
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The optional step after the summary: how it felt, three toggles,
/// electrolytes after, water, then Save or Skip.
public struct WatchSaunaRatingContent: View {
    let rating: SaunaRatingModel
    let onChange: (SaunaRatingModel) -> Void
    let onSave: () -> Void
    let onSkip: () -> Void

    public init(rating: SaunaRatingModel, onChange: @escaping (SaunaRatingModel) -> Void, onSave: @escaping () -> Void, onSkip: @escaping () -> Void) {
        self.rating = rating; self.onChange = onChange; self.onSave = onSave; self.onSkip = onSkip
    }

    private func toggle(_ title: String, _ on: Bool, _ set: @escaping (inout SaunaRatingModel) -> Void) -> some View {
        Button { var r = rating; set(&r); onChange(r) } label: {
            HStack {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Pal.text)
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Pal.accent : Pal.text3)
            }
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        }
        .buttonStyle(WatchTileStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            Text("How it felt").font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: PepitoTheme.Space.s4) {
                ForEach(1...5, id: \.self) { n in
                    Button("\(n)") { var r = rating; r.feel = r.feel == n ? nil : n; onChange(r) }
                        .buttonStyle(WatchSecondaryButtonStyle(height: 36, selected: rating.feel == n))
                        .accessibilityLabel("Felt \(n) of 5")
                        .accessibilityAddTraits(rating.feel == n ? .isSelected : [])
                }
            }
            toggle("Lightheaded", rating.lightheaded) { $0.lightheaded.toggle() }
            toggle("Headache", rating.headache) { $0.headache.toggle() }
            toggle("Cramps", rating.cramps) { $0.cramps.toggle() }
            toggle("Electrolytes after", rating.electrolytes) { $0.electrolytes.toggle() }
            HStack(spacing: PepitoTheme.Space.s8) {
                Button { var r = rating; r.water(-SaunaRatingModel.waterStep); onChange(r) } label: { Image(systemName: "minus") }
                    .buttonStyle(WatchSecondaryButtonStyle(height: 36)).accessibilityLabel("Less water")
                VStack(spacing: 0) {
                    Text("\(rating.waterMl)").font(.system(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(Pal.text)
                    Text("ml water").font(.system(size: 12, weight: .medium)).foregroundStyle(Pal.text2)
                }
                .frame(minWidth: 56)
                .accessibilityElement(children: .combine)
                Button { var r = rating; r.water(SaunaRatingModel.waterStep); onChange(r) } label: { Image(systemName: "plus") }
                    .buttonStyle(WatchSecondaryButtonStyle(height: 36)).accessibilityLabel("More water")
            }
            Button(action: onSave) { Label("Save", systemImage: "checkmark") }
                .buttonStyle(WatchPrimaryButtonStyle())
            Button("Skip", action: onSkip)
                .buttonStyle(WatchSecondaryButtonStyle(height: 36))
        }
        .frame(maxWidth: .infinity)
    }
}
#endif
