#if os(watchOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

// Watch sleep mode: Start sleep, the night screen, the morning, and the
// Pepito sleep complication. The night screen is black with a dim red-orange
// clock, redrawn at most once a minute; Always On dims it further.

/// Night red: dim and warm, kind to dark-adapted eyes.
let nightRed = Color(red: 0.86, green: 0.36, blue: 0.2)

/// Before bed: one large Start sleep, last night under it, the battery.
public struct WatchSleepStartContent: View {
    let lastNight: Snapshot.LastNight?
    let battery: Double?
    let start: () -> Void

    public init(lastNight: Snapshot.LastNight?, battery: Double?, start: @escaping () -> Void) {
        self.lastNight = lastNight; self.battery = battery; self.start = start
    }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s12) {
            Image(systemName: "moon.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Pal.text)
                .accessibilityHidden(true)
            Button(action: start) { Text("Start sleep") }
                .buttonStyle(WatchPrimaryButtonStyle())
                .pepitoPrimaryGesture()
            Text("Sleep sounds starts on your iPhone")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Pal.text2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let n = lastNight?.asleepMin {
                Text("Last night \(SleepMode.duration(n))")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Pal.text2)
                    .monospacedDigit()
            }
            if let b = battery, b >= 0 {
                Text(BatteryWords.bedtime(b))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(b < 0.3 ? Pal.warn : Pal.text2)
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// While asleep: black, the time in dim red-orange, time since lights out, the latest heart rate, the battery.
public struct WatchNightContent: View {
    let since: Date
    let lastHR: Int?
    let lastHRAt: Date?
    let battery: Double?
    let up: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.watchMetrics) private var m

    public init(since: Date, lastHR: Int?, lastHRAt: Date?, battery: Double?, up: @escaping () -> Void) {
        self.since = since; self.lastHR = lastHR; self.lastHRAt = lastHRAt; self.battery = battery; self.up = up
    }

    public var body: some View {
        // once a minute at most: no seconds anywhere on this screen
        TimelineView(.everyMinute) { ctx in
            VStack(spacing: PepitoTheme.Space.s8) {
                Text(Clock.time(ctx.date))
                    .font(PepitoTheme.number(m.isSmall ? 34 : 40))
                    .foregroundStyle(nightRed.opacity(dimmed ? 0.45 : 0.8))
                    .monospacedDigit()
                Text(SleepMode.sinceLightsOut(since, now: ctx.date))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(nightRed.opacity(dimmed ? 0.35 : 0.6))
                    .monospacedDigit()
                if let hr = lastHR {
                    Text("Heart rate \(hr) bpm\(lastHRAt.map { " · \(Clock.time($0))" } ?? "")")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(nightRed.opacity(dimmed ? 0.3 : 0.5))
                        .monospacedDigit()
                }
                if let b = battery, b >= 0 {
                    Text("Battery \(Int((b * 100).rounded()))%")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(nightRed.opacity(dimmed ? 0.25 : 0.4))
                        .monospacedDigit()
                }
                if !dimmed {
                    Button(action: up) { Text("I'm up") }
                        .buttonStyle(NightButtonStyle())
                        .padding(.top, PepitoTheme.Space.s4)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.black.ignoresSafeArea())
    }
}

/// A dark, quiet button for the night screen.
struct NightButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(nightRed.opacity(0.8))
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Capsule().fill(nightRed.opacity(configuration.isPressed ? 0.25 : 0.14)))
            .contentShape(Capsule())
    }
}

/// The morning: last night in one screen once Health has it.
public struct WatchMorningContent: View {
    let morning: SleepMode.Morning?
    let done: () -> Void

    public init(morning: SleepMode.Morning?, done: @escaping () -> Void) { self.morning = morning; self.done = done }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            if let m = morning {
                Text(SleepMode.duration(m.asleepMin))
                    .font(PepitoTheme.number(34))
                    .foregroundStyle(Pal.text)
                    .monospacedDigit()
                Text("asleep last night")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Pal.text2)
                VStack(spacing: 0) {
                    row("Sleep score", m.score.map(String.init))
                    row("Readiness", m.readiness.map(String.init))
                    row("Restless", m.restless.map { "\($0)" })
                    row("Snoring", m.snoringMin.map { "\($0) min" })
                }
            } else {
                Image(systemName: "moon.zzz.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Pal.text2)
                Text("Waiting for Health to sync last night")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Pal.text2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: done) { Text("Done") }
                .buttonStyle(WatchSecondaryButtonStyle())
                .padding(.top, PepitoTheme.Space.s4)
        }
        .frame(maxWidth: .infinity)
    }

    private func row(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label).font(.system(size: 15, weight: .medium)).foregroundStyle(Pal.text2)
            Spacer(minLength: 0)
            Text(value ?? "–").font(PepitoTheme.number(15, weight: .semibold)).foregroundStyle(Pal.text)
        }
        .frame(minHeight: 28)
        .accessibilityElement(children: .combine)
    }
}

public enum BatteryWords {
    /// "Battery 64%" or, under 30%, the nudge.
    public static func bedtime(_ level: Double) -> String {
        let pct = Int((level * 100).rounded())
        return level < 0.3 ? "Battery \(pct)%: charge to 30% for the night" : "Battery \(pct)%"
    }
}

// MARK: - the Pepito sleep complication

/// accessoryCircular: a moon to start; asleep, the time since lights out; by day, last night's score.
public struct SleepCircularComplication: View {
    let state: SleepMode.Complication
    public init(state: SleepMode.Complication) { self.state = state }

    public var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch state {
            case .start, .empty:
                Image(systemName: "moon.fill").font(.system(size: 22, weight: .semibold))
            case .sleeping(let since):
                VStack(spacing: 0) {
                    Image(systemName: "moon.zzz.fill").font(.system(size: 13, weight: .semibold))
                    Text(since, style: .timer).font(PepitoTheme.number(12, weight: .semibold)).multilineTextAlignment(.center)
                }
            case .score(let s):
                VStack(spacing: 0) {
                    Image(systemName: "moon.fill").font(.system(size: 11, weight: .semibold))
                    Text("\(s)").font(PepitoTheme.number(18, weight: .semibold))
                }
            case .hours(let m):
                VStack(spacing: 0) {
                    Image(systemName: "moon.fill").font(.system(size: 11, weight: .semibold))
                    Text("\(m / 60)h").font(PepitoTheme.number(16, weight: .semibold))
                }
            }
        }
        .foregroundStyle(.white)
        .pepitoAccentable()
        .accessibilityLabel(label)
    }

    private var label: String {
        switch state {
        case .start, .empty: return "Start sleep"
        case .sleeping: return "Sleeping"
        case .score(let s): return "Last night's sleep score \(s)"
        case .hours(let m): return "Last night \(SleepMode.duration(m))"
        }
    }
}

/// accessoryCorner: the moon, with "Start sleep", the time asleep or last night's score along the corner.
public struct SleepCornerComplication: View {
    let state: SleepMode.Complication
    public init(state: SleepMode.Complication) { self.state = state }

    public var body: some View {
        Image(systemName: "moon.fill")
            .font(.system(size: 20, weight: .semibold))
            .widgetLabel { label }
            .pepitoAccentable()
            .accessibilityLabel("Pepito sleep")
    }

    @ViewBuilder private var label: some View {
        switch state {
        case .start, .empty: Text("Start sleep")
        case .sleeping(let since): Text(since, style: .timer)
        case .score(let s): Text("Sleep \(s)")
        case .hours(let m): Text(SleepMode.duration(m))
        }
    }
}
#endif
