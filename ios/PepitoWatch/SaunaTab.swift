import SwiftUI
import WatchKit
import PepitoCore
import PepitoTheme

/// Sauna: set the target and temperature with the Digital Crown (starting
/// from the usual ones), start, watch the time, heart rate, ring and zone, mark
/// rounds, stop, and read the summary.
struct SaunaTab: View {
    @EnvironmentObject private var sauna: SaunaWorkoutManager

    var body: some View {
        switch sauna.phase {
        case .idle: SaunaSetup()
        case .running, .saving: SaunaRunning()
        case .summary: SaunaSummaryView()
        }
    }
}

/// Apple's own guidance, shown once before a hot session starts.
let heatWarningAboveC = 55

private struct SaunaSetup: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @State private var minutes = 20
    @State private var temp = 60
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(spacing: PepitoTheme.Space.s8) {
                Text("Sauna").pepitoCaption().frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: PepitoTheme.Space.s4) {
                    Picker("Minutes", selection: $minutes) {
                        ForEach(1...120, id: \.self) { Text("\($0) min").monospacedDigit().tag($0) }
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 64)
                    .accessibilityLabel("Target, \(minutes) minutes")
                    Picker("Temperature", selection: $temp) {
                        ForEach(30...120, id: \.self) { Text("\($0) C").monospacedDigit().tag($0) }
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 64)
                    .accessibilityLabel("Temperature, \(temp) degrees")
                }
                if temp > heatWarningAboveC {
                    Text("Apple advises not wearing Apple Watch above 55 C.")
                        .font(PepitoTheme.Typography.small)
                        .foregroundStyle(PepitoTheme.Palette.warn)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    Task { await sauna.start(targetMin: minutes, tempC: temp) }
                } label: {
                    Text("Start")
                        .font(PepitoTheme.Typography.label)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .tint(PepitoTheme.Palette.sauna)
                .accessibilityLabel("Start sauna, \(minutes) minutes at \(temp) degrees")
                if let w = store.snapshot?.sauna.week {
                    Text("\(w.sessions) of \(w.target) this week")
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text3)
                }
            }
        }
        .onAppear {
            guard !loaded, let u = store.snapshot?.sauna.usual else { return }
            minutes = u.lengthMin
            temp = u.tempC
            loaded = true
        }
    }
}

private struct SaunaRunning: View {
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let start = sauna.startDate ?? Date()
        // Always On: once a minute, no seconds, still readable
        TimelineView(.periodic(from: start, by: dimmed ? 60 : 1)) { context in
            let elapsed = max(0, context.date.timeIntervalSince(start))
            let fraction = min(1, elapsed / Double(sauna.targetMin * 60))
            ScrollView {
                VStack(spacing: PepitoTheme.Space.s8) {
                    ZStack {
                        Circle().stroke(PepitoTheme.Palette.surfaceSunk, lineWidth: 8)
                        Circle().trim(from: 0, to: fraction)
                            .stroke(PepitoTheme.Palette.sauna, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        VStack(spacing: 0) {
                            Text(clock(elapsed, seconds: !dimmed))
                                .font(PepitoTheme.Typography.metricSmall)
                                .foregroundStyle(PepitoTheme.Palette.text)
                            Text("of \(sauna.targetMin) min")
                                .font(PepitoTheme.Typography.small.monospacedDigit())
                                .foregroundStyle(PepitoTheme.Palette.text2)
                        }
                    }
                    .frame(width: 112, height: 112)
                    .opacity(dimmed ? 0.6 : 1)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(Int(elapsed / 60)) of \(sauna.targetMin) minutes")

                    HStack {
                        Label(sauna.heartRate.map { "\(Int($0.rounded()))" } ?? "--", systemImage: "heart.fill")
                            .font(PepitoTheme.Typography.label.monospacedDigit())
                            .foregroundStyle(PepitoTheme.Palette.text)
                            .accessibilityLabel(sauna.heartRate.map { "Heart rate \(Int($0.rounded()))" } ?? "Heart rate not yet read")
                        Spacer()
                        Text(sauna.zone.map { $0 > 0 ? "Zone \($0)" : "Below zone 1" } ?? "")
                            .font(PepitoTheme.Typography.small)
                            .foregroundStyle(PepitoTheme.Palette.text2)
                    }
                    Text("\(sauna.tempC) C, round \(sauna.rounds)")
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text3)

                    if !dimmed {
                        Button { sauna.nextRound() } label: {
                            Text("Next round").font(PepitoTheme.Typography.label).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .disabled(sauna.phase != .running)
                        Button { sauna.stop() } label: {
                            Text(sauna.phase == .saving ? "Saving" : "Stop").font(PepitoTheme.Typography.label).frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .tint(PepitoTheme.Palette.danger)
                        .disabled(sauna.phase != .running)
                        .accessibilityLabel("Stop sauna and save")
                    }
                }
            }
        }
    }

    private func clock(_ t: TimeInterval, seconds: Bool) -> String {
        let total = Int(t)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if !seconds { return h > 0 ? "\(h) h \(m) min" : "\(m) min" }
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}

/// After Stop, like the Workout app: duration, temperature, heart rate,
/// minutes in each zone and rounds, then Done.
private struct SaunaSummaryView: View {
    @EnvironmentObject private var sauna: SaunaWorkoutManager

    var body: some View {
        ScrollView {
            if let s = sauna.summary {
                VStack(alignment: .leading, spacing: PepitoTheme.Space.s8) {
                    Text("Sauna saved").pepitoCaption()
                    Text("\(Int((s.end.timeIntervalSince(s.start) / 60).rounded())) min")
                        .font(PepitoTheme.Typography.metric)
                        .foregroundStyle(PepitoTheme.Palette.text)
                    row("Temperature", "\(s.tempC) C")
                    row("Average heart rate", s.avgHR.map { "\($0) bpm" } ?? "–")
                    row("Peak heart rate", s.peakHR.map { "\($0) bpm" } ?? "–")
                    row("Rounds", "\(s.rounds)")
                    Text("Minutes in each zone").pepitoCaption().padding(.top, PepitoTheme.Space.s4)
                    ForEach(Array(s.zoneMinutes.enumerated()), id: \.offset) { i, m in
                        row("Zone \(i + 1)", String(format: "%.1f", m))
                    }
                    Button { sauna.dismissSummary() } label: {
                        Text("Done").font(PepitoTheme.Typography.label).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .padding(.top, PepitoTheme.Space.s8)
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(PepitoTheme.Typography.small).foregroundStyle(PepitoTheme.Palette.text2)
            Spacer()
            Text(value).font(PepitoTheme.Typography.label.monospacedDigit()).foregroundStyle(PepitoTheme.Palette.text)
        }
        .accessibilityElement(children: .combine)
    }
}
