import SwiftUI
import WatchKit
import HealthKit
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
                WatchHomeContent(snap: store.snapshot, now: ctx.date, night: store.sleepNight) { store.open($0) }
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
    @State private var asNeeded = false

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            content(now: ctx.date)
        }
        .containerBackground(WatchBG.doses, for: .navigation)
        .navigationDestination(isPresented: $asNeeded) { AsNeededScreen() }
        .onChange(of: WatchHome.doseScreen(store.snapshot, now: Date())?.allLogged ?? false) { _, done in
            if done { bounce += 1 }
        }
        // the tick left a vial about empty: one question right after it
        .sheet(item: Binding(
            get: { store.vialQuestions.first },
            set: { if $0 == nil, let q = store.vialQuestions.first { store.dismissVial(q) } }
        )) { q in
            ScrollView {
                WatchVialQuestionContent(
                    name: q.name,
                    onYes: { WKInterfaceDevice.current().play(.success); store.answerVial(q, yes: true) },
                    onStill: { WKInterfaceDevice.current().play(.click); store.answerVial(q, yes: false) })
            }
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
                asNeededRow
                    .padding(.bottom, PepitoTheme.Space.s40)
            }
            .navigationTitle(screen.slot.title)
            .toolbar {
                // one row left: its own tick is the action, no Log all
                if due.count > 1 {
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
            }
        } else {
            ScrollView {
                WatchAllLoggedContent(next: WatchHome.doseScreen(store.snapshot, now: now)?.next, bounce: bounce)
                asNeededRow
            }
            .navigationTitle("Doses")
        }
    }

    @ViewBuilder
    private var asNeededRow: some View {
        let items = AsNeededPicker.items(store.snapshot)
        if !items.isEmpty {
            WatchAsNeededRow(items: items) { asNeeded = true }
                .padding(.top, PepitoTheme.Space.s8)
        }
    }
}

/// As needed: pick the item, then the amount with the Crown, then Log.
struct AsNeededScreen: View {
    @EnvironmentObject private var store: WatchStore
    @State private var picked: Snapshot.AsNeeded?

    var body: some View {
        ScrollView {
            WatchAsNeededListContent(items: AsNeededPicker.items(store.snapshot)) { picked = $0 }
        }
        .navigationTitle("As needed")
        .containerBackground(WatchBG.doses, for: .navigation)
        .navigationDestination(item: $picked) { item in AsNeededAmountScreen(item: item) }
    }
}

struct AsNeededAmountScreen: View {
    let item: Snapshot.AsNeeded
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dismiss) private var dismiss
    @State private var crown: Double = 0
    @State private var unit = ""

    var body: some View {
        let amount = AsNeededPicker.snap(crown, step: item.step)
        WatchAsNeededAmountContent(item: item, amount: amount, unit: unit, onUnit: { unit = $0 }) {
            WKInterfaceDevice.current().play(.success)
            store.send(.asNeeded(item.id, amount: amount, unit: unit, source: .watch))
            dismiss()
        }
        .focusable()
        .digitalCrownRotation($crown, from: 0, through: max(item.step * 40, 10), by: item.step, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .navigationTitle(item.short)
        .containerBackground(WatchBG.doses, for: .navigation)
        .onAppear {
            crown = AsNeededPicker.start(item)
            unit = AsNeededPicker.unit(item)
        }
    }
}

// MARK: - Evening

/// The evening sheet, from the evening prompt's Log. Each evening item taps
/// on at your last amount (or opens the Crown when there is none), drinks
/// step, the rest toggle, and Save sends it all to the iPhone.
struct EveningScreen: View {
    @EnvironmentObject private var store: WatchStore
    @Environment(\.dismiss) private var dismiss
    @State private var taken: [String: Double] = [:]
    @State private var drinks = 0
    @State private var on: Set<String> = []
    @State private var amountFor: Snapshot.AsNeeded?

    var body: some View {
        let sedatives = EveningSheetModel.sedatives(store.snapshot)
        ScrollView {
            WatchEveningContent(
                sedatives: sedatives, taken: taken, drinks: drinks, toggles: EveningSheetModel.toggles(store.snapshot), on: on,
                onNothing: { finish(EveningSheetModel.actions(drinks: 0, factors: [], taken: [])) },
                onSedative: { item in
                    if taken[item.id] != nil { taken[item.id] = nil }
                    else if let last = item.last, last > 0 { taken[item.id] = last }
                    else { amountFor = item }
                },
                onDrinks: { drinks = $0 },
                onToggle: { id in if on.contains(id) { on.remove(id) } else { on.insert(id) } },
                onSave: {
                    let items = sedatives.compactMap { i in taken[i.id].map { (item: i, amount: $0, unit: AsNeededPicker.unit(i)) } }
                    finish(EveningSheetModel.actions(drinks: drinks, factors: Array(on).sorted(), taken: items))
                })
        }
        .navigationTitle("Evening")
        .containerBackground(WatchBG.doses, for: .navigation)
        .sheet(item: $amountFor) { item in
            EveningAmountSheet(item: item) { amount in taken[item.id] = amount; amountFor = nil }
        }
    }

    private func finish(_ actions: [PendingAction]) {
        WKInterfaceDevice.current().play(.success)
        store.send(actions)
        store.banner = "Saved for tonight."
        dismiss()
    }
}

/// An evening item with no last amount: the Crown sets it.
struct EveningAmountSheet: View {
    let item: Snapshot.AsNeeded
    let onSet: (Double) -> Void
    @State private var crown: Double = 0
    @State private var unit = ""

    var body: some View {
        let amount = AsNeededPicker.snap(crown, step: item.step)
        WatchAsNeededAmountContent(item: item, amount: amount, unit: unit, onUnit: { unit = $0 }) { onSet(amount) }
            .focusable()
            .digitalCrownRotation($crown, from: 0, through: max(item.step * 40, 10), by: item.step, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
            .onAppear { crown = AsNeededPicker.start(item); unit = AsNeededPicker.unit(item) }
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
            case .coolDown: SaunaCoolDownScreen()
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
        .persistentSystemOverlays(.hidden)
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

/// Five minutes of heart rate after Stop; Done ends it early.
struct SaunaCoolDownScreen: View {
    @EnvironmentObject private var sauna: SaunaWorkoutManager

    var body: some View {
        TimelineView(.periodic(from: sauna.exitAt ?? Date(), by: 1)) { ctx in
            WatchSaunaCoolDownContent(exitAt: sauna.exitAt ?? ctx.date, now: ctx.date, heartRate: sauna.heartRate,
                                      exitHR: sauna.exitHR, onDone: { sauna.endCoolDown() })
        }
        .navigationBarBackButtonHidden(true)
    }
}

struct SaunaSummaryScreen: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    /// Done on the summary opens the optional rating step
    @State private var rating: SaunaRatingModel?

    var body: some View {
        ScrollView {
            if let r = rating, let s = sauna.summary {
                WatchSaunaRatingContent(rating: r, onChange: { rating = $0 }, onSave: {
                    if let a = r.action(sessionStart: s.start, workoutId: sauna.lastWorkoutId) {
                        WKInterfaceDevice.current().play(.success)
                        store.send(a)
                    }
                    finish()
                }, onSkip: finish)
            } else if let s = sauna.summary {
                WatchSaunaSummaryContent(summary: SaunaSummaryState(
                    start: s.start, end: s.end, tempC: s.tempC, rounds: s.rounds, avgHR: s.avgHR, peakHR: s.peakHR,
                    zoneMinutes: s.zoneMinutes, samples: s.samples, activeSec: s.activeSec, coolDown: s.coolDown)) {
                    rating = SaunaRatingModel()
                }
            }
        }
        .navigationTitle(rating == nil ? "Summary" : "Rating")
        .navigationBarBackButtonHidden(true)
    }

    private func finish() {
        rating = nil
        sauna.dismissSummary()
        store.path = []
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

// MARK: - Sleep

/// Sleep mode: Start sleep in the evening, the dark night screen once the lights are out,
/// and last night in the morning. No workout session and no live sensors: the heart rate
/// shown is the latest sample Health already has, read when the screen appears and once a minute.
struct SleepScreen: View {
    @EnvironmentObject private var store: WatchStore
    @State private var hr: (bpm: Int, at: Date)?
    @State private var battery: Double = -1

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            content(now: ctx.date)
                .task(id: ctx.date) { await refresh() }
        }
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        switch SleepMode.phase(now: now, night: store.sleepNight) {
        case .sleeping(let since):
            WatchNightContent(since: since, lastHR: hr?.bpm, lastHRAt: hr?.at, battery: battery >= 0 ? battery : nil) {
                WKInterfaceDevice.current().play(.click)
                store.wakeUp()
            }
            .toolbar(.hidden, for: .navigationBar)
            .containerBackground(Color.black, for: .navigation)
        case .evening:
            ScrollView {
                WatchSleepStartContent(lastNight: store.snapshot?.sleep?.lastNight, battery: battery >= 0 ? battery : nil) {
                    WKInterfaceDevice.current().play(.start)
                    store.startSleep()
                }
            }
            .navigationTitle("Sleep")
            .containerBackground(WatchBG.home, for: .navigation)
        case .morning, .day:
            ScrollView {
                WatchMorningContent(morning: SleepMode.morning(lastNight: store.snapshot?.sleep?.lastNight, night: store.sleepNight)) {
                    store.path = []
                }
            }
            .navigationTitle("Last night")
            .containerBackground(WatchBG.home, for: .navigation)
        }
    }

    private func refresh() async {
        let device = WKInterfaceDevice.current()
        device.isBatteryMonitoringEnabled = true
        battery = Double(device.batteryLevel)
        if SleepMode.isSleeping(store.sleepNight, now: Date()) { hr = await NightHeartRate.latest() }
    }
}

/// The latest heart rate sample Health has from the last two hours: one query, no sensor of our own.
enum NightHeartRate {
    private static let health = HKHealthStore()

    static func latest(now: Date = Date()) async -> (bpm: Int, at: Date)? {
        guard HKHealthStore.isHealthDataAvailable(), let type = HKObjectType.quantityType(forIdentifier: .heartRate) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: now.addingTimeInterval(-2 * 3600), end: now, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        return await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: sort) { _, samples, _ in
                guard let s = samples?.first as? HKQuantitySample else { cont.resume(returning: nil); return }
                let bpm = s.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                cont.resume(returning: (Int(bpm.rounded()), s.endDate))
            }
            health.execute(q)
        }
    }
}
