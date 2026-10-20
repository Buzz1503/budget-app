import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents
import PepitoCore
import PepitoTheme

/// The sauna Live Activity: elapsed time counting live, a ring to the target,
/// the temperature, and Stop. Lock Screen always; Dynamic Island compact and
/// expanded where the iPhone has it. With iOS 18 and watchOS 11 it also shows
/// in the Apple Watch Smart Stack, built from the compact layout.
struct SaunaLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SaunaActivityAttributes.self) { context in
            SaunaLockScreenView(state: context.state, targetMin: context.attributes.targetMin)
                .activityBackgroundTint(PepitoTheme.Palette.bg)
                .activitySystemActionForegroundColor(PepitoTheme.Palette.text)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SaunaRing(state: context.state, size: 44)
                        .padding(.leading, PepitoTheme.Space.s4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 0) {
                        Text(context.state.startedAt, style: .timer)
                            .font(PepitoTheme.Typography.metricSmall)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(PepitoTheme.Palette.text)
                        Text("of \(context.attributes.targetMin) min, \(context.state.tempC) C")
                            .font(PepitoTheme.Typography.small.monospacedDigit())
                            .foregroundStyle(PepitoTheme.Palette.text2)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StopButton()
                }
            } compactLeading: {
                Image(systemName: "flame.fill").foregroundStyle(PepitoTheme.Palette.sauna)
                    .accessibilityLabel("Sauna")
            } compactTrailing: {
                Text(context.state.startedAt, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
                    .foregroundStyle(PepitoTheme.Palette.text)
            } minimal: {
                SaunaRing(state: context.state, size: 20)
            }
            .keylineTint(PepitoTheme.Palette.sauna)
        }
    }
}

struct SaunaRing: View {
    let state: SaunaActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        ProgressView(timerInterval: state.startedAt...state.targetAt, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            .progressViewStyle(.circular)
            .tint(PepitoTheme.Palette.sauna)
            .frame(width: size, height: size)
            .accessibilityLabel("Progress to target")
    }
}

struct StopButton: View {
    var body: some View {
        Button(intent: StopSaunaIntent()) {
            Text("Stop")
                .font(PepitoTheme.Typography.label)
                .padding(.horizontal, PepitoTheme.Space.s16)
                .frame(minHeight: 44)
                .background(Capsule().fill(PepitoTheme.Palette.surfaceSunk))
                .foregroundStyle(PepitoTheme.Palette.text)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stop sauna")
    }
}

struct SaunaLockScreenView: View {
    let state: SaunaActivityAttributes.ContentState
    let targetMin: Int

    var body: some View {
        HStack(spacing: PepitoTheme.Space.s16) {
            SaunaRing(state: state, size: 52)
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                Text("Sauna").pepitoCaption()
                Text(state.startedAt, style: .timer)
                    .font(PepitoTheme.Typography.metric)
                    .foregroundStyle(PepitoTheme.Palette.text)
                Text("Target \(targetMin) min, \(state.tempC) C")
                    .font(PepitoTheme.Typography.small.monospacedDigit())
                    .foregroundStyle(PepitoTheme.Palette.text2)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            StopButton()
        }
        .padding(PepitoTheme.Space.s16)
    }
}
