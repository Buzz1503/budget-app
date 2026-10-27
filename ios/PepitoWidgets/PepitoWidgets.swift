import WidgetKit
import SwiftUI
import AppIntents
import PepitoCore
import PepitoTheme
import PepitoWidgetUI

// The Home Screen, Lock Screen and StandBy widgets. Each draws a view from
// PepitoWidgetUI (the same ones design-snapshots/ shows) inside WidgetRoot,
// which passes on how the system is rendering it and wires the buttons to
// their App Intents.

extension WidgetActions {
    static let live = WidgetActions(
        tick: { id, label in AnyView(Button(intent: TickDoseIntent(rowId: id)) { label }.buttonStyle(.plain)) },
        startSauna: { label in AnyView(Button(intent: StartSaunaIntent()) { label }.buttonStyle(.plain)) },
        stopSauna: { label in AnyView(Button(intent: StopSaunaIntent()) { label }.buttonStyle(.plain)) },
        stopSleepSounds: { label in AnyView(Button(intent: StopSleepSoundsLiveIntent()) { label }.buttonStyle(.plain)) }
    )
}

/// Full colour, accented or vibrant; StandBy when the system drops the container.
struct WidgetRoot<Content: View>: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.showsWidgetContainerBackground) private var showsBackground
    @Environment(\.widgetFamily) private var family
    let content: Content

    init(@ViewBuilder _ content: () -> Content) { self.content = content() }

    var body: some View {
        let accessory = ([.accessoryCircular, .accessoryRectangular, .accessoryInline] as [WidgetFamily]).contains(family)
        content
            .environment(\.surfaceMode, SurfaceMode(renderingMode))
            .environment(\.isStandBy, !showsBackground && !accessory)
            .environment(\.widgetActions, .live)
            .containerBackground(PepitoTheme.Palette.bg, for: .widget)
    }
}

/// Doses. Small: the next dose and one Log button. Medium: the slot, a tick for each.
struct TodayWidget: Widget {
    let kind = "PepitoToday"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            WidgetRoot { DosesEntryView(entry: entry) }
        }
        .configurationDisplayName("Doses")
        .description("The next dose with one Log button, or the whole slot with a tick for each.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct DosesEntryView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let state = DoseWidgetState(entry.snapshot, now: entry.date)
        if family == .systemMedium {
            TodayMediumView(state: state)
        } else {
            NextDoseSmallView(state: state)
        }
    }
}

/// Lock Screen: the next dose (rectangular) and a line (inline).
struct NextDoseInlineWidget: Widget {
    let kind = "PepitoNextDose"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            WidgetRoot { NextDoseLockView(entry: entry) }
        }
        .configurationDisplayName("Next dose")
        .description("The next dose and when it is due.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct NextDoseLockView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryInline {
            NextDoseInlineContent(snap: entry.snapshot, now: entry.date)
        } else {
            NextDoseRectangularView(snap: entry.snapshot, now: entry.date)
        }
    }
}

/// Readiness (small), and on the Lock Screen (circular), where a running sauna takes its place.
struct ReadinessWidget: Widget {
    let kind = "PepitoReadiness"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            WidgetRoot { ReadinessEntryView(entry: entry) }
        }
        .configurationDisplayName("Readiness")
        .description("Today's readiness score and band from Apple Health.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct ReadinessEntryView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryCircular {
            ReadinessCircularView(snap: entry.snapshot)
        } else {
            let stale = entry.snapshot.flatMap { s in ReadinessAge.isStale(s, now: entry.date) ? ReadinessAge.asOf(s) : nil }
            ReadinessSmallView(readiness: entry.snapshot?.readiness, stale: stale)
        }
    }
}

/// Sauna: this week and Start; while a session runs, the time and Stop.
struct SaunaWidget: Widget {
    let kind = "PepitoSauna"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            WidgetRoot { SaunaSmallView(sauna: entry.snapshot?.sauna) }
        }
        .configurationDisplayName("Sauna")
        .description("This week's sessions, and Start or Stop in one tap.")
        .supportedFamilies([.systemSmall])
    }
}

/// The sauna Live Activity: Lock Screen, and the Dynamic Island where the iPhone has one.
struct SaunaLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SaunaActivityAttributes.self) { context in
            SaunaLockScreenView(live: SaunaLive(context.state))
                .environment(\.widgetActions, .live)
                .activityBackgroundTint(PepitoTheme.Palette.bg)
                .activitySystemActionForegroundColor(PepitoTheme.Palette.text)
        } dynamicIsland: { context in
            let live = SaunaLive(context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SaunaIslandExpanded.leading(live)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SaunaIslandExpanded.trailing(live).environment(\.widgetActions, .live)
                }
                DynamicIslandExpandedRegion(.center) {
                    SaunaIslandExpanded.center(live)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    SaunaIslandExpanded.bottom(live)
                }
            } compactLeading: {
                SaunaIslandCompactLeading()
            } compactTrailing: {
                SaunaIslandCompactTrailing(live: live)
            } minimal: {
                SaunaIslandMinimal(live: live)
            }
            .keylineTint(PepitoTheme.Palette.accent)
        }
    }
}

extension SaunaLive {
    init(_ s: SaunaActivityAttributes.ContentState) {
        self.init(startedAt: s.startedAt, targetAt: s.targetAt, tempC: s.tempC, rounds: s.rounds,
                  heartRate: s.heartRate, pausedAt: s.pausedAt)
    }
}

/// Sleep sounds listening: on the Lock Screen and in the Dynamic Island while it runs, with Stop.
struct SleepSoundsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SleepSoundsActivityAttributes.self) { context in
            SleepSoundsLockScreenView(live: SleepSoundsLive(context.state))
                .environment(\.widgetActions, .live)
                .activityBackgroundTint(PepitoTheme.Palette.bg)
                .activitySystemActionForegroundColor(PepitoTheme.Palette.text)
        } dynamicIsland: { context in
            let live = SleepSoundsLive(context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { SleepSoundsIsland.leading() }
                DynamicIslandExpandedRegion(.trailing) { SleepSoundsIsland.trailing().environment(\.widgetActions, .live) }
                DynamicIslandExpandedRegion(.center) { SleepSoundsIsland.center(live) }
                DynamicIslandExpandedRegion(.bottom) { SleepSoundsIsland.bottom(live) }
            } compactLeading: {
                SleepSoundsIsland.compactLeading()
            } compactTrailing: {
                SleepSoundsIsland.compactTrailing(live)
            } minimal: {
                SleepSoundsIsland.minimal()
            }
        }
    }
}

extension SleepSoundsLive {
    init(_ s: SleepSoundsActivityAttributes.ContentState) {
        self.init(startedAt: s.startedAt, until: s.until, paused: s.paused)
    }
}
