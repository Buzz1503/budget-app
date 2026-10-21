#if os(iOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

/// One running session as the Live Activity draws it.
public struct SaunaLive: Equatable {
    public var startedAt: Date
    public var targetAt: Date
    public var tempC: Int
    public var rounds: Int
    public var heartRate: Int?
    public var pausedAt: Date?

    public init(startedAt: Date, targetAt: Date, tempC: Int, rounds: Int, heartRate: Int? = nil, pausedAt: Date? = nil) {
        self.startedAt = startedAt; self.targetAt = targetAt; self.tempC = tempC; self.rounds = rounds
        self.heartRate = heartRate; self.pausedAt = pausedAt
    }

    var autoEnd: Date { startedAt.addingTimeInterval(SaunaLimits.autoEndAfter) }
    /// "60°C · Round 2"
    var detail: String { "\(tempC)°C · Round \(rounds)" }
    var fractionAtPause: Double {
        guard let p = pausedAt else { return 0 }
        let total = targetAt.timeIntervalSince(startedAt)
        return total > 0 ? min(1, max(0, p.timeIntervalSince(startedAt) / total)) : 0
    }
}

/// The elapsed time, counting up live (held while paused).
struct SaunaTimerText: View {
    let live: SaunaLive
    var body: some View {
        Text(timerInterval: live.startedAt...live.autoEnd, pauseTime: live.pausedAt, countsDown: false)
            .monospacedDigit()
    }
}

/// The thin bar to the target.
struct SaunaProgressBar: View {
    let live: SaunaLive
    var body: some View {
        Group {
            if live.pausedAt != nil {
                ProgressView(value: live.fractionAtPause)
            } else {
                ProgressView(timerInterval: live.startedAt...live.targetAt, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            }
        }
        .progressViewStyle(.linear)
        .tint(Pal.accent)
        .accessibilityLabel("Progress to target")
    }
}

/// The flame in an accent-tinted circle.
struct SaunaBadge: View {
    let size: CGFloat
    var body: some View {
        Image(systemName: "flame.fill")
            .font(.system(size: size * 0.48, weight: .semibold))
            .foregroundStyle(Pal.accent)
            .frame(width: size, height: size)
            .background(Circle().fill(Pal.accent.opacity(0.18)))
            .accessibilityHidden(true)
    }
}

struct LiveHeartRate: View {
    let bpm: Int
    var body: some View {
        Label {
            Text("\(bpm)").font(PepitoTheme.number(WT.caption, weight: .semibold))
        } icon: {
            Image(systemName: "heart.fill").font(.system(size: WT.caption - 1, weight: .semibold))
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Heart rate \(bpm)")
    }
}

struct StopCapsule: View {
    @Environment(\.widgetActions) private var actions
    var body: some View {
        actions.stopSauna(AnyView(
            HStack(spacing: PepitoTheme.Space.s4) {
                Image(systemName: "stop.fill").font(.system(size: WT.caption, weight: .bold))
                Text("Stop").font(WT.titleFont())
            }
            .foregroundStyle(.black)
            .padding(.horizontal, PepitoTheme.Space.s16)
            .frame(minHeight: PepitoTheme.minTap)
            .background(Capsule().fill(.white))
            .contentShape(Capsule())
        ))
        .accessibilityLabel("Stop sauna")
    }
}

/// Lock Screen and notification banner.
public struct SaunaLockScreenView: View {
    let live: SaunaLive
    public init(live: SaunaLive) { self.live = live }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s12) {
            HStack(alignment: .center, spacing: PepitoTheme.Space.s12) {
                SaunaBadge(size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sauna").font(WT.titleFont()).foregroundStyle(.primary)
                    HStack(spacing: PepitoTheme.Space.s8) {
                        Text(live.detail).font(WT.captionFont()).monospacedDigit().foregroundStyle(.secondary)
                        if let bpm = live.heartRate { LiveHeartRate(bpm: bpm) }
                    }
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 0)
                SaunaTimerText(live: live)
                    .font(PepitoTheme.number(WT.hero))
                    .foregroundStyle(live.pausedAt == nil ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 140, alignment: .trailing)
            }
            HStack(spacing: PepitoTheme.Space.s16) {
                SaunaProgressBar(live: live)
                StopCapsule()
            }
        }
        .foregroundStyle(Pal.text)
        .padding(PepitoTheme.Space.s16)
    }
}

/// Dynamic Island, expanded: the timer centred, the live heart rate while
/// the Watch runs the session, and Stop.
public struct SaunaIslandExpanded {
    public static func leading(_ live: SaunaLive) -> some View {
        SaunaBadge(size: 40).padding(.leading, PepitoTheme.Space.s4)
    }
    public static func trailing(_ live: SaunaLive) -> some View {
        StopCapsule().padding(.trailing, PepitoTheme.Space.s4)
    }
    public static func center(_ live: SaunaLive) -> some View {
        SaunaTimerText(live: live)
            .font(PepitoTheme.number(WT.hero))
            .foregroundStyle(Pal.text)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }
    public static func bottom(_ live: SaunaLive) -> some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            HStack(spacing: PepitoTheme.Space.s8) {
                Text(live.detail).font(WT.captionFont()).monospacedDigit()
                if let bpm = live.heartRate { LiveHeartRate(bpm: bpm) }
            }
            .foregroundStyle(Pal.text2)
            SaunaProgressBar(live: live)
        }
        .padding(.horizontal, PepitoTheme.Space.s8)
    }
}

public struct SaunaIslandCompactLeading: View {
    public init() {}
    public var body: some View {
        Image(systemName: "flame.fill").foregroundStyle(Pal.accent).accessibilityLabel("Sauna")
    }
}

public struct SaunaIslandCompactTrailing: View {
    let live: SaunaLive
    public init(live: SaunaLive) { self.live = live }
    public var body: some View {
        SaunaTimerText(live: live)
            .font(PepitoTheme.number(WT.title, weight: .semibold))
            .foregroundStyle(Pal.accent)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 56)
    }
}

public struct SaunaIslandMinimal: View {
    let live: SaunaLive
    public init(live: SaunaLive) { self.live = live }
    public var body: some View {
        Group {
            if live.pausedAt != nil {
                ProgressView(value: live.fractionAtPause)
            } else {
                ProgressView(timerInterval: live.startedAt...live.targetAt, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            }
        }
        .progressViewStyle(.circular)
        .tint(Pal.accent)
        .accessibilityLabel("Sauna, progress to target")
    }
}
#endif
