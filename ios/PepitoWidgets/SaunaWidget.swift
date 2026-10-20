import WidgetKit
import SwiftUI
import AppIntents
import PepitoCore
import PepitoTheme

/// Sauna: sessions this week against the target and a Start button; while a
/// session runs, the elapsed time counting live, a ring to the target, and Stop.
struct SaunaWidget: Widget {
    let kind = "PepitoSauna"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            SaunaWidgetView(entry: entry)
                .containerBackground(PepitoTheme.Palette.bg, for: .widget)
        }
        .configurationDisplayName("Sauna")
        .description("This week's sessions, and Start or Stop in one tap.")
        .supportedFamilies([.systemSmall])
    }
}

struct SaunaWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        if let sauna = entry.snapshot?.sauna {
            if let a = sauna.active { running(a) } else { idle(sauna) }
        } else {
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s8) {
                Text("Sauna").pepitoCaption()
                Text("Open Pepito+ once to fill this in.")
                    .font(PepitoTheme.Typography.label)
                    .foregroundStyle(PepitoTheme.Palette.text2)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func idle(_ s: Snapshot.Sauna) -> some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
            Text("Sauna").pepitoCaption()
            HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s4) {
                Text("\(s.week.sessions)")
                    .font(PepitoTheme.Typography.metric)
                    .foregroundStyle(s.week.sessions >= s.week.target ? PepitoTheme.Palette.accent : PepitoTheme.Palette.text)
                Text("of \(s.week.target)")
                    .font(PepitoTheme.Typography.label.monospacedDigit())
                    .foregroundStyle(PepitoTheme.Palette.text2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(s.week.sessions) of \(s.week.target) sessions this week")
            Text("this week, \(s.week.heatMin) min")
                .font(PepitoTheme.Typography.small.monospacedDigit())
                .foregroundStyle(PepitoTheme.Palette.text3)
            Spacer(minLength: 0)
            Button(intent: StartSaunaIntent()) {
                Label("Start", systemImage: "flame")
                    .font(PepitoTheme.Typography.label)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(PepitoTheme.Palette.surfaceSunk))
                    .foregroundStyle(PepitoTheme.Palette.text)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Start sauna, \(s.usual.lengthMin) minutes at \(s.usual.tempC) degrees")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func running(_ a: Snapshot.Sauna.Active) -> some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            ZStack {
                ProgressView(timerInterval: a.startDate...a.targetDate, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.circular)
                    .tint(PepitoTheme.Palette.sauna)
                Text(a.startDate, style: .timer)
                    .font(PepitoTheme.Typography.metricSmall)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(PepitoTheme.Palette.text)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: 76)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Sauna running, target \(a.targetMin) minutes at \(a.tempC) degrees")
            Button(intent: StopSaunaIntent()) {
                Text("Stop")
                    .font(PepitoTheme.Typography.label)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(PepitoTheme.Palette.surfaceSunk))
                    .foregroundStyle(PepitoTheme.Palette.text)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop sauna")
        }
    }
}
