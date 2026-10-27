#if os(iOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

/// The Sleep sounds Live Activity as it draws: listening, until when, and Stop.
public struct SleepSoundsLive: Equatable {
    public var startedAt: Date
    public var until: Date
    public var paused: Bool
    public init(startedAt: Date, until: Date, paused: Bool = false) { self.startedAt = startedAt; self.until = until; self.paused = paused }
}

struct SleepSoundsBadge: View {
    let size: CGFloat
    var body: some View {
        Image(systemName: "waveform")
            .font(.system(size: size * 0.46, weight: .semibold))
            .foregroundStyle(Pal.text)
            .frame(width: size, height: size)
            .background(Circle().fill(Pal.surfaceSunk))
            .accessibilityHidden(true)
    }
}

struct SleepSoundsStop: View {
    @Environment(\.widgetActions) private var actions
    var body: some View {
        actions.stopSleepSounds(AnyView(
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
        .accessibilityLabel("Stop sleep sounds")
    }
}

/// Lock Screen: "Sleep sounds listening", "until 5:00" (or paused), Stop.
public struct SleepSoundsLockScreenView: View {
    let live: SleepSoundsLive
    public init(live: SleepSoundsLive) { self.live = live }

    public var body: some View {
        HStack(alignment: .center, spacing: PepitoTheme.Space.s12) {
            SleepSoundsBadge(size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(live.paused ? "Sleep sounds paused" : "Sleep sounds listening").font(WT.titleFont()).foregroundStyle(.primary).lineLimit(1)
                (Text("until ") + Text(live.until, style: .time)).font(WT.captionFont()).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            SleepSoundsStop()
        }
        .foregroundStyle(Pal.text)
        .padding(PepitoTheme.Space.s16)
    }
}

/// Dynamic Island: the waveform, "until 5:00", and Stop when expanded.
public enum SleepSoundsIsland {
    public static func leading() -> some View { SleepSoundsBadge(size: 36) }
    public static func center(_ live: SleepSoundsLive) -> some View {
        Text(live.paused ? "Sleep sounds paused" : "Sleep sounds listening").font(WT.titleFont()).lineLimit(1)
    }
    public static func trailing() -> some View { SleepSoundsStop() }
    public static func bottom(_ live: SleepSoundsLive) -> some View {
        (Text("until ") + Text(live.until, style: .time)).font(WT.captionFont()).monospacedDigit().foregroundStyle(.secondary)
    }
    public static func compactLeading() -> some View {
        Image(systemName: "waveform").foregroundStyle(Pal.text).accessibilityLabel("Sleep sounds")
    }
    public static func compactTrailing(_ live: SleepSoundsLive) -> some View {
        Text(live.until, style: .time).monospacedDigit().font(.caption2).foregroundStyle(.secondary)
    }
    public static func minimal() -> some View { Image(systemName: "waveform").foregroundStyle(Pal.text) }
}
#endif
