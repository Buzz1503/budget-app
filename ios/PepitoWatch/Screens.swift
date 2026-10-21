import SwiftUI
import WatchKit
import PepitoCore
import PepitoTheme
import PepitoWatchUI

// The Watch app's screens: the views from PepitoWatchUI (the ones
// design-snapshots/ shows) with navigation, the Digital Crown, haptics and
// the page backgrounds around them.

typealias WatchBG = PepitoTheme.WatchBackground

struct HomeScreen: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            ScrollView {
                WatchHomeContent(snap: store.snapshot, now: ctx.date) { store.open($0) }
            }
        }
        .navigationTitle("Pepito+")
        .containerBackground(WatchBG.home, for: .navigation)
    }
}

// MARK: - Doses

struct DosesScreen: View {
    @EnvironmentObject private var store: WatchStore
    @State private var bounce = 0

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            content(now: ctx.date)
        }
        .containerBackground(WatchBG.doses, for: .navigation)
        .onChange(of: WatchHome.doseScreen(store.snapshot, now: Date())?.allLogged ?? false) { _, done in
            if done { bounce += 1 }
        }
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        if store.snapshot == nil {
            WatchMessageContent(symbol: "iphone", title: "Open Pepito+ on your iPhone", detail: "Your doses appear here after that.")
                .navigationTitle("Doses")
        } else if let p = store.snapshot?.paused, p.active, p.wholeProtocol {
            WatchMessageContent(symbol: "pause.circle.fill", title: "Protocol paused", detail: p.reason)
                .navigationTitle("Doses")
        } else if let screen = WatchHome.doseScreen(store.snapshot, now: now), !screen.allLogged {
            let due = screen.rows.filter { $0.status == .due }
            ScrollView {
                WatchDosesContent(screen: screen, loggedAt: store.loggedAt, willSync: store.willSync,
                                  onLog: { row in
                                      WKInterfaceDevice.current().play(.success)
                                      withAnimation(.snappy) { store.log(row) }
                                  },
                                  onSkip: { row in
                                      WKInterfaceDevice.current().play(.click)
                                      withAnimation(.snappy) { store.skip(row) }
                                  })
                    .padding(.bottom, PepitoTheme.Space.s40)
            }
            .navigationTitle(screen.slot.title)
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Spacer()
                    Button {
                        WKInterfaceDevice.current().play(.success)
                        withAnimation(.snappy) { store.logAll(due) }
                    } label: {
                        WatchLogAllLabel(count: due.count, verb: due.first?.verb ?? "Log")
                    }
                    .tint(PepitoTheme.Palette.accent)
                    .foregroundStyle(PepitoTheme.Palette.accentForeground)
                    .buttonStyle(.borderedProminent)
                    Spacer()
                }
            }
        } else {
            WatchAllLoggedContent(next: WatchHome.doseScreen(store.snapshot, now: now)?.next, bounce: bounce)
                .navigationTitle("Doses")
        }
    }
}

// MARK: - Sauna

struct SaunaScreen: View {
    @EnvironmentObject private var sauna: SaunaWorkoutManager

    var body: some View {
        Group {
            switch sauna.phase {
            case .idle: SaunaStartScreen()
            case .running, .saving: SaunaRunningScreen()
            case .summary: SaunaSummaryScreen()
            }
        }
        .containerBackground(WatchBG.sauna, for: .navigation)
    }
}

struct SaunaStartScreen: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @State private var temp: Double = 80
    @State private var minutes = 20
    @State private var loaded = false
    @State private var choosingTarget = false

    var body: some View {
        ScrollView {
            WatchSaunaStartContent(tempC: Int(temp.rounded()), targetMin: minutes,
                                   onStart: { Task { await sauna.start(targetMin: minutes, tempC: Int(temp.rounded())) } },
                                   onTarget: { choosingTarget = true })
        }
        .focusable()
        .digitalCrownRotation($temp, from: 30, through: 120, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .navigationTitle("Sauna")
        .navigationDestination(isPresented: $choosingTarget) {
            TargetScreen(minutes: $minutes)
        }
        .onAppear {
            guard !loaded, let u = store.snapshot?.sauna.usual else { return }
            temp = Double(u.tempC)
            minutes = u.lengthMin
            loaded = true
        }
    }
}

struct TargetScreen: View {
    @Binding var minutes: Int
    @State private var value: Double = 20
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        WatchTargetContent(minutes: Int(value.rounded())) {
            minutes = Int(value.rounded())
            dismiss()
        }
        .focusable()
        .digitalCrownRotation($value, from: 1, through: 120, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .navigationTitle("Target")
        .containerBackground(WatchBG.sauna, for: .navigation)
        .onAppear { value = Double(minutes) }
    }
}

/// The running session: the ring, time and heart rate; swipe left for the controls.
struct SaunaRunningScreen: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var page = 0
    @State private var confirmStop = false

    var body: some View {
        TabView(selection: $page) {
            TimelineView(.periodic(from: sauna.startDate ?? Date(), by: dimmed ? 60 : 1)) { ctx in
                WatchSaunaRunningContent(state: runState, now: ctx.date)
            }
            .ignoresSafeArea()
            .tag(0)
            WatchSaunaControlsContent(paused: sauna.isPaused, rounds: sauna.rounds,
                                      onStop: { confirmStop = true },
                                      onNextRound: { sauna.nextRound(); page = 0 },
                                      onPause: { sauna.togglePause(); page = 0 })
                .tag(1)
        }
        .tabViewStyle(.page)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .confirmationDialog("Stop and save this session?", isPresented: $confirmStop, titleVisibility: .visible) {
            Button("Stop", role: .destructive) { sauna.stop(); page = 0 }
            Button("Keep going", role: .cancel) {}
        }
    }

    private var runState: SaunaRunState {
        let snap = store.snapshot
        return SaunaRunState(startedAt: sauna.startDate ?? Date(), targetMin: sauna.targetMin, tempC: sauna.tempC,
                             rounds: sauna.rounds, heartRate: dimmed ? sauna.minuteHeartRate : sauna.heartRate,
                             maxHR: snap?.watch.maxHR ?? 190, floors: snap?.watch.zoneFloors ?? [0.5, 0.6, 0.7, 0.8, 0.9],
                             recent: sauna.recent, pausedSec: sauna.pausedSec, pausedAt: sauna.pausedAt)
    }
}

struct SaunaSummaryScreen: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager

    var body: some View {
        ScrollView {
            if let s = sauna.summary {
                WatchSaunaSummaryContent(summary: SaunaSummaryState(
                    start: s.start, end: s.end, tempC: s.tempC, rounds: s.rounds, avgHR: s.avgHR, peakHR: s.peakHR,
                    zoneMinutes: s.zoneMinutes, samples: s.samples, activeSec: s.activeSec)) {
                    sauna.dismissSummary()
                    store.path = []
                }
            }
        }
        .navigationTitle("Summary")
        .navigationBarBackButtonHidden(true)
    }
}

// MARK: - Readiness

struct ReadinessScreen: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        let s = store.snapshot
        let asOf = s.flatMap { ReadinessAge.isStale($0, now: Date()) ? ReadinessAge.asOf($0) : nil }
        ScrollView {
            WatchReadinessContent(readiness: s?.readiness, asOf: asOf)
        }
        .navigationTitle("Readiness")
        .containerBackground(WatchBG.readiness(s?.readiness?.band), for: .navigation)
    }
}
