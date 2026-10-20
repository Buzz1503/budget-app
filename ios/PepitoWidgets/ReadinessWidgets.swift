import WidgetKit
import SwiftUI
import PepitoCore
import PepitoTheme

/// Readiness: today's score and band (small, and Lock Screen circular).
struct ReadinessWidget: Widget {
    let kind = "PepitoReadiness"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            ReadinessWidgetView(entry: entry)
                .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Readiness")
        .description("Today's readiness score and band from Apple Health.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct ReadinessWidgetView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    private var r: Snapshot.Readiness? { entry.snapshot?.readiness }

    var body: some View {
        if family == .accessoryCircular { circular } else { small }
    }

    private var circular: some View {
        Gauge(value: Double(r?.score ?? 0), in: 0...100) {
            Text("Ready")
        } currentValueLabel: {
            Text(r?.score.map(String.init) ?? "–").monospacedDigit()
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
        .accessibilityLabel(spoken)
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
            Text("Readiness").pepitoCaption()
            if let score = r?.score {
                Text("\(score)")
                    .font(PepitoTheme.Typography.metric)
                    .foregroundStyle(PepitoTheme.Palette.text)
                Text(r?.bandLabel ?? "")
                    .font(PepitoTheme.Typography.h2)
                    .foregroundStyle(PepitoTheme.bandColor(r?.band))
            } else {
                Text(r?.status == "building" ? "Building baseline" : r == nil ? "Connect Apple Health in Pepito+" : "Not enough data from last night")
                    .font(PepitoTheme.Typography.label)
                    .foregroundStyle(PepitoTheme.Palette.text2)
            }
            Spacer(minLength: 0)
            if let line = vitals {
                Text(line)
                    .font(PepitoTheme.Typography.small.monospacedDigit())
                    .foregroundStyle(PepitoTheme.Palette.text2)
                    .lineLimit(2)
            }
            if let s = entry.snapshot, WatchLaunch.readinessIsStale(s, now: entry.date), let asOf = asOfDate {
                Text("as of \(asOf.formatted(date: .omitted, time: .shortened))")
                    .font(PepitoTheme.Typography.small)
                    .foregroundStyle(PepitoTheme.Palette.text3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken)
    }

    private var vitals: String? {
        guard let r else { return nil }
        let parts = [r.rhr.map { "RHR \(Int($0.rounded()))" }, r.hrv.map { "HRV \(Int($0.rounded())) ms" }].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private var asOfDate: Date? {
        guard let iso = r?.asOf ?? entry.snapshot?.generatedAt else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    private var spoken: String {
        guard let score = r?.score, let band = r?.bandLabel else { return "Readiness not available" }
        return "Readiness \(score), \(band)"
    }
}

/// Lock Screen inline: "Next: Reta 3 mg, 8 pm".
struct NextDoseInlineWidget: Widget {
    let kind = "PepitoNextDose"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            NextDoseInlineView(entry: entry)
                .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Next dose")
        .description("The next dose and when it is due.")
        .supportedFamilies([.accessoryInline])
    }
}

struct NextDoseInlineView: View {
    let entry: SnapshotEntry

    var body: some View {
        let next = entry.snapshot.flatMap { DoseBoard.next($0, now: entry.date) }
        if let snap = entry.snapshot, snap.paused.active, snap.paused.wholeProtocol {
            Text("Protocol paused")
        } else if let next {
            Text(next.label)
        } else {
            Text(entry.snapshot == nil ? "Pepito+" : "All logged")
        }
    }
}
