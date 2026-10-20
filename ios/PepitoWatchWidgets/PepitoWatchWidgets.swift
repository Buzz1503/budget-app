import WidgetKit
import SwiftUI
import PepitoCore
import PepitoTheme

// Complications and Smart Stack widgets. They read the snapshot the Watch app
// keeps in the Watch's App Group; the app reloads them the moment a new
// snapshot arrives from the iPhone, so readiness, the next dose and the sauna
// state are always current.

struct WatchEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct WatchProvider: TimelineProvider {
    func placeholder(in context: Context) -> WatchEntry { WatchEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (WatchEntry) -> Void) {
        completion(WatchEntry(date: Date(), snapshot: SharedStore.shared().readSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WatchEntry>) -> Void) {
        let snap = SharedStore.shared().readSnapshot()
        let now = Date()
        let cal = Calendar.current
        var dates = [now]
        let start = cal.startOfDay(for: now)
        if let split = cal.date(byAdding: .hour, value: snap?.slotSplitHour ?? 14, to: start), split > now { dates.append(split) }
        if let midnight = cal.date(byAdding: .day, value: 1, to: start) { dates.append(midnight) }
        completion(Timeline(entries: dates.map { WatchEntry(date: $0, snapshot: snap) }, policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

/// Readiness (circular).
struct WatchReadinessWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchReadiness", provider: WatchProvider()) { entry in
            let r = entry.snapshot?.readiness
            Gauge(value: Double(r?.score ?? 0), in: 0...100) {
                Text("Ready")
            } currentValueLabel: {
                Text(r?.score.map(String.init) ?? "–").monospacedDigit()
            }
            .gaugeStyle(.accessoryCircular)
            .tint(PepitoTheme.bandColor(r?.band))
            .widgetAccentable()
            .accessibilityLabel(r?.score.map { "Readiness \($0), \(r?.bandLabel ?? "")" } ?? "Readiness not available")
            .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Readiness")
        .description("Today's readiness score.")
        .supportedFamilies([.accessoryCircular])
    }
}

/// The next dose (rectangular).
struct WatchNextDoseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchNextDose", provider: WatchProvider()) { entry in
            let next = entry.snapshot.flatMap { DoseBoard.next($0, now: entry.date) }
            VStack(alignment: .leading, spacing: 2) {
                Text(next.map { "\($0.slot.title), \(DoseBoard.clockLabel($0.time))" } ?? "Pepito+")
                    .font(.system(.caption2, design: .default).weight(.heavy))
                    .textCase(.uppercase)
                    .foregroundStyle(PepitoTheme.Palette.text3)
                Text(next?.line ?? (entry.snapshot == nil ? "Open Pepito+" : "All logged"))
                    .font(.system(.headline, design: .default).weight(.bold).monospacedDigit())
                    .foregroundStyle(PepitoTheme.Palette.text)
                    .lineLimit(2)
                    .widgetAccentable()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Next dose")
        .description("The next dose and when it is due.")
        .supportedFamilies([.accessoryRectangular])
    }
}

/// Sauna quick start (circular): opens straight into the Sauna start screen.
struct WatchSaunaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PepitoWatchSauna", provider: WatchProvider()) { entry in
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: entry.snapshot?.sauna.active != nil ? "flame.fill" : "flame")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(PepitoTheme.Palette.sauna)
                    .widgetAccentable()
            }
            .widgetURL(URL(string: "pepito://sauna"))
            .accessibilityLabel(entry.snapshot?.sauna.active != nil ? "Sauna running" : "Start sauna")
            .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Sauna")
        .description("Open the sauna start screen in one tap.")
        .supportedFamilies([.accessoryCircular])
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
