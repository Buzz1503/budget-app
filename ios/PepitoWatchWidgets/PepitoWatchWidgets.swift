import WidgetKit
import SwiftUI
import PepitoCore
import PepitoTheme
import PepitoWatchUI

// Complications and Smart Stack widgets. They read the snapshot the Watch app
// keeps in the Watch's App Group; the app reloads them the moment a new
// snapshot arrives from the iPhone or a dose is ticked here. Each opens its
// own screen. Each entry carries a relevance, so the Smart Stack brings the
// next dose up half an hour before its slot, the sauna while a session runs
// and readiness in the morning.

struct WatchEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    var relevance: TimelineEntryRelevance?
}

enum WatchWidgetKind { case readiness, nextDose, sauna }

struct WatchProvider: TimelineProvider {
    let kind: WatchWidgetKind

    func placeholder(in context: Context) -> WatchEntry { WatchEntry(date: Date(), snapshot: nil) }

    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        let snap = SharedStore.shared().readSnapshot()
        completion(entry(snap, at: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let snap = SharedStore.shared().readSnapshot()
        let now = Date()
        let entries = WidgetRelevance.moments(snap, from: now).map { entry(snap, at: $0) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(6 * 3600))))
    }

    private func entry(_ snap: Snapshot?, at date: Date) -> WatchEntry {
        let r: WidgetRelevance.Score
        switch kind {
        case .readiness: r = WidgetRelevance.readiness(snap, at: date)
        case .nextDose: r = WidgetRelevance.nextDose(snap, at: date)
        case .sauna: r = WidgetRelevance.sauna(snap, at: date)
        }
        return WatchEntry(date: date, snapshot: snap, relevance: TimelineEntryRelevance(score: r.score, duration: r.duration))
    }
}

/// Passes on how the face is rendering the widget.
struct WatchWidgetRoot<Content: View>: View {
    @Environment(\.widgetRenderingMode) private var renderingMode
    let route: WatchRoute
    let content: Content
    init(_ route: WatchRoute, @ViewBuilder _ content: () -> Content) { self.route = route; self.content = content() }

    var body: some View {
        content
            .environment(\.surfaceMode, renderingMode == .accented ? .accented : renderingMode == .vibrant ? .vibrant : .fullColor)
            .widgetURL(route.url)
            .containerBackground(PepitoTheme.Palette.bg, for: .widget)
    }
}

/// Readiness (circular).
struct WatchReadinessWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchReadiness", provider: WatchProvider(kind: .readiness)) { entry in
            WatchWidgetRoot(.readiness) { ReadinessComplication(readiness: entry.snapshot?.readiness) }
        }
        .configurationDisplayName("Readiness")
        .description("Today's readiness score.")
        .supportedFamilies([.accessoryCircular])
    }
}

/// The next dose (rectangular, and in the Smart Stack) and inline.
struct WatchNextDoseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchNextDose", provider: WatchProvider(kind: .nextDose)) { entry in
            WatchWidgetRoot(.doses) { NextDoseFamilyView(entry: entry) }
        }
        .configurationDisplayName("Next dose")
        .description("The next dose and when it is due.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

struct NextDoseFamilyView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        if family == .accessoryInline {
            NextDoseInlineComplication(snap: entry.snapshot, now: entry.date)
        } else {
            NextDoseComplication(snap: entry.snapshot, now: entry.date)
        }
    }
}

/// The sauna (circular, and corner on faces that have corners): opens the sauna screen.
struct WatchSaunaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchSauna", provider: WatchProvider(kind: .sauna)) { entry in
            WatchWidgetRoot(.sauna) { SaunaFamilyView(entry: entry) }
        }
        .configurationDisplayName("Sauna")
        .description("This week's sessions; opens the sauna in one tap.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner])
    }
}

struct SaunaFamilyView: View {
    let entry: WatchEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        if family == .accessoryCorner {
            SaunaCornerComplication(sauna: entry.snapshot?.sauna)
        } else {
            SaunaCircularComplication(sauna: entry.snapshot?.sauna)
        }
    }
}

@main
struct PepitoWatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WatchReadinessWidget()
        WatchNextDoseWidget()
        WatchSaunaWidget()
    }
}
