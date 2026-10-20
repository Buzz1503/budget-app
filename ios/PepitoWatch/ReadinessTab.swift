import SwiftUI
import PepitoCore
import PepitoTheme

/// Readiness: today's score and band, resting heart rate and HRV against
/// usual, and last night's sleep. The "as of" time shows once the snapshot is
/// more than six hours old.
struct ReadinessTab: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let r = store.snapshot?.readiness
        ScrollView {
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s8) {
                Text("Readiness").pepitoCaption()
                if let score = r?.score {
                    HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s8) {
                        Text("\(score)")
                            .font(PepitoTheme.Typography.metric)
                            .foregroundStyle(PepitoTheme.Palette.text)
                        Text(r?.bandLabel ?? "")
                            .font(PepitoTheme.Typography.h2)
                            .foregroundStyle(PepitoTheme.bandColor(r?.band))
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Readiness \(score), \(r?.bandLabel ?? "")")
                } else {
                    Text(r == nil ? "Connect Apple Health in Pepito+ on your iPhone." : r?.status == "building" ? "Building a baseline." : "Not enough data from last night.")
                        .font(PepitoTheme.Typography.label)
                        .foregroundStyle(PepitoTheme.Palette.text2)
                }
                if let r {
                    vital("Resting HR", value: r.rhr.map { "\(Int($0.rounded()))" }, delta: r.rhrDelta, unit: "bpm")
                    vital("HRV", value: r.hrv.map { "\(Int($0.rounded()))" }, delta: r.hrvDelta, unit: "ms")
                    if let m = r.sleepMin {
                        HStack {
                            Text("Sleep").font(PepitoTheme.Typography.small).foregroundStyle(PepitoTheme.Palette.text2)
                            Spacer()
                            Text("\(Int(m) / 60) h \(Int(m) % 60) min").font(PepitoTheme.Typography.label.monospacedDigit())
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if let s = store.snapshot, WatchLaunch.readinessIsStale(s, now: Date()), let asOf = asOfDate(s) {
                    Text("as of \(asOf.formatted(date: .abbreviated, time: .shortened))")
                        .font(PepitoTheme.Typography.small)
                        .foregroundStyle(PepitoTheme.Palette.text3)
                }
            }
            .opacity(dimmed ? 0.7 : 1)
        }
    }

    private func vital(_ label: String, value: String?, delta: Double?, unit: String) -> some View {
        HStack {
            Text(label).font(PepitoTheme.Typography.small).foregroundStyle(PepitoTheme.Palette.text2)
            Spacer()
            Text("\(value ?? "–") \(unit)").font(PepitoTheme.Typography.label.monospacedDigit())
            if let d = delta {
                Text(String(format: "%@%.0f", d > 0 ? "+" : d < 0 ? "−" : "", abs(d)))
                    .font(PepitoTheme.Typography.small.monospacedDigit())
                    .foregroundStyle(PepitoTheme.Palette.text3)
                    .accessibilityLabel("\(d > 0 ? "up" : d < 0 ? "down" : "same") \(Int(abs(d).rounded())) on usual")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func asOfDate(_ s: Snapshot) -> Date? {
        let iso = s.readiness?.asOf ?? s.generatedAt
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}
