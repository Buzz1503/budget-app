#if os(watchOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

// The Watch's Sleep screen and complication: read-only, last night from Apple
// Health through the snapshot. Nothing on the Watch starts or records sleep.

/// Last night in one screen: time asleep, then score, readiness, wake-ups and awake minutes.
public struct WatchLastNightContent: View {
    let summary: SleepMode.Summary?

    public init(summary: SleepMode.Summary?) { self.summary = summary }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            if let m = summary {
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
                    row("Woke", m.wakeUps.map { "\($0)×" })
                    row("Awake", m.awakeMin.map { "\($0) min" })
                }
            } else {
                Image(systemName: "moon.zzz.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(Pal.text2)
                Text("Last night shows once Health has it")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Pal.text2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
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

// MARK: - the Pepito sleep complication

/// accessoryCircular: last night's score, or its hours.
public struct SleepCircularComplication: View {
    let state: SleepMode.Complication
    public init(state: SleepMode.Complication) { self.state = state }

    public var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            switch state {
            case .empty:
                Image(systemName: "moon.fill").font(.system(size: 22, weight: .semibold))
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
        case .empty: return "Last night"
        case .score(let s): return "Last night's sleep score \(s)"
        case .hours(let m): return "Last night \(SleepMode.duration(m))"
        }
    }
}

/// accessoryCorner: the moon, with last night's score or hours along the corner.
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
        case .empty: Text("Last night")
        case .score(let s): Text("Sleep \(s)")
        case .hours(let m): Text(SleepMode.duration(m))
        }
    }
}
#endif
