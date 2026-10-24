import Foundation
import HealthKit
import WatchKit
import PepitoCore

/// The sauna on the wrist: an indoor "other" workout session with a live
/// builder, so heart rate is recorded the whole time and the session is saved
/// to Health with its metadata. Haptics at start and stop, at every 5-minute
/// mark and a distinct one at the target; a round split on Next round (or the
/// Ultra's Action Button); Pause holds the clock. Every 30 seconds the heart
/// rate, round and pause go to the iPhone for its Live Activity. Stop saves the workout and sends the session to the phone, which
/// adds it to the app (source Watch, linked to the workout) with the full
/// heart-rate series, so it is never offered as "Was this a sauna?".
/// With Cool down on (the default), Stop first keeps reading heart rate for
/// 5 minutes after leaving (Done ends it early); the workout still ends at
/// the moment of Stop, and the cool-down goes to the phone with the session.
@MainActor
final class SaunaWorkoutManager: NSObject, ObservableObject {
    static let shared = SaunaWorkoutManager()

    enum Phase: Equatable { case idle, running, coolDown, saving, summary }

    struct Summary: Equatable {
        var start: Date
        var end: Date
        var tempC: Int
        var rounds: Int
        var avgHR: Int?
        var peakHR: Int?
        var zoneMinutes: [Double]
        var samples: [SaunaHeartRate.Sample]
        var activeSec: Double
        var coolDown: SaunaHeartRate.CoolDownDrop?
    }

    @Published private(set) var phase: Phase = .idle
    /// The Health workout of the session just saved, for the rating step
    private(set) var lastWorkoutId: String?
    @Published private(set) var heartRate: Double?
    @Published private(set) var startDate: Date?
    @Published private(set) var targetMin = 20
    @Published private(set) var tempC = 60
    @Published private(set) var roundSplits: [Date] = []
    @Published private(set) var summary: Summary?
    /// The last ten minutes of heart rate, for the running screen's line.
    @Published private(set) var recent: [SaunaHeartRate.Sample] = []
    /// The heart rate as Always On shows it: refreshed once a minute.
    @Published private(set) var minuteHeartRate: Double?
    @Published private(set) var pausedAt: Date?
    @Published private(set) var pausedSec: Double = 0
    /// When Stop was pressed, during the cool-down.
    @Published private(set) var exitAt: Date?
    /// Heart rate at the moment of Stop, for "N lower" on the cool-down screen.
    @Published private(set) var exitHR: Double?

    private let health = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var samples: [SaunaHeartRate.Sample] = []
    private var coolSamples: [SaunaHeartRate.Sample] = []
    private var ticker: Timer?
    private var lastElapsed: TimeInterval = 0
    private var targetBuzzed = false
    private var stoppedFromPhone = false
    private var lastLiveSent = Date.distantPast
    private var lastMinute = -1

    var rounds: Int { roundSplits.count + 1 }
    var isRunning: Bool { phase == .running }
    var isPaused: Bool { pausedAt != nil }

    /// Time in the session, not counting pauses.
    func elapsed(at now: Date = Date()) -> TimeInterval {
        guard let start = startDate else { return 0 }
        return max(0, (pausedAt ?? now).timeIntervalSince(start) - pausedSec)
    }

    // MARK: - authorization

    func requestAuthorization() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable(), NativeFeatures.watchHealthKit else { return false }
        let share: Set<HKSampleType> = [HKObjectType.workoutType(), HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]
        let read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKObjectType.workoutType()]
        do {
            try await health.requestAuthorization(toShare: share, read: read)
            return true
        } catch {
            return false
        }
    }

    // MARK: - start

    /// Start with the given target and temperature (the usual ones when nil).
    func start(targetMin: Int? = nil, tempC: Int? = nil, startedOnPhone: Bool = false) async {
        guard phase == .idle || phase == .summary else { return }
        let snap = WatchStore.shared.snapshot
        self.targetMin = targetMin ?? snap?.sauna.active?.targetMin ?? snap?.sauna.usual.lengthMin ?? 20
        self.tempC = tempC ?? snap?.sauna.active?.tempC ?? snap?.sauna.usual.tempC ?? 60
        summary = nil
        roundSplits = []
        samples = []
        coolSamples = []
        exitAt = nil
        exitHR = nil
        heartRate = nil
        minuteHeartRate = nil
        recent = []
        pausedAt = nil
        pausedSec = 0
        lastLiveSent = .distantPast
        lastMinute = -1
        targetBuzzed = false
        lastElapsed = 0
        stoppedFromPhone = false

        let start = Date()
        startDate = start
        phase = .running
        WKInterfaceDevice.current().play(.start)

        if NativeFeatures.watchHealthKit, await requestAuthorization() {
            let config = HKWorkoutConfiguration()
            config.activityType = .other
            config.locationType = .indoor
            do {
                let s = try HKWorkoutSession(healthStore: health, configuration: config)
                let b = s.associatedWorkoutBuilder()
                let source = HKLiveWorkoutDataSource(healthStore: health, workoutConfiguration: config)
                // "Count sauna toward Move ring" off: no active energy is saved with the session
                if !(snap?.watch.countTowardMove ?? false) {
                    source.disableCollection(for: HKQuantityType(.activeEnergyBurned))
                }
                b.dataSource = source
                b.delegate = self
                s.delegate = self
                session = s
                builder = b
                s.startActivity(with: start)
                try await b.beginCollection(at: start)
            } catch {
                session = nil
                builder = nil
            }
        }

        // tell the phone a session is running (it keeps its timer, widget and Live Activity in step)
        if !startedOnPhone, snap?.sauna.active == nil {
            WatchStore.shared.send(PendingAction(type: .startSauna, at: start, source: .watch,
                                                 payload: .init(startedAt: start.timeIntervalSince1970 * 1000, targetMin: self.targetMin,
                                                                tempC: self.tempC, rounds: 1)))
        }
        startTicker()
    }

    /// The Ultra's Action Button, and the Next round button: start, or mark the next round.
    func startOrNextRound() async {
        if isRunning { nextRound() } else { await start() }
    }

    func nextRound() {
        guard isRunning else { return }
        roundSplits.append(Date())
        WKInterfaceDevice.current().play(.directionUp)
        sendLive(force: true)
    }

    func togglePause() {
        guard isRunning else { return }
        let now = Date()
        if let p = pausedAt {
            pausedSec += now.timeIntervalSince(p)
            pausedAt = nil
            session?.resume()
            WKInterfaceDevice.current().play(.start)
        } else {
            pausedAt = now
            session?.pause()
            WKInterfaceDevice.current().play(.stop)
        }
        sendLive(force: true)
    }

    private func sendLive(force: Bool = false, now: Date = Date()) {
        guard force || now.timeIntervalSince(lastLiveSent) >= LiveSauna.interval else { return }
        lastLiveSent = now
        WatchStore.shared.sendLive(LiveSauna(heartRate: heartRate.map { Int($0.rounded()) }, rounds: rounds, at: now,
                                             pausedSec: pausedSec + (pausedAt.map { now.timeIntervalSince($0) } ?? 0),
                                             paused: pausedAt != nil))
    }

    // MARK: - haptics

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        if phase == .coolDown, let exit = exitAt, Date().timeIntervalSince(exit) >= SaunaHeartRate.coolDownSec {
            endCoolDown()
            return
        }
        guard isRunning else { return }
        let now = Date()
        let minute = Int(now.timeIntervalSince1970 / 60)
        if minute != lastMinute { lastMinute = minute; minuteHeartRate = heartRate }
        sendLive(now: now)
        guard pausedAt == nil else { return }
        let elapsed = self.elapsed(at: now)
        let marks = SaunaHeartRate.fiveMinuteMarks(elapsedFrom: lastElapsed, to: elapsed)
        lastElapsed = elapsed
        if !targetBuzzed, elapsed >= TimeInterval(targetMin * 60) {
            targetBuzzed = true
            WKInterfaceDevice.current().play(.notification)
        } else if !marks.isEmpty {
            WKInterfaceDevice.current().play(.click)
        }
    }

    // MARK: - stop

    func stop(fromPhone: Bool = false) {
        guard isRunning else { return }
        stoppedFromPhone = fromPhone
        ticker?.invalidate()
        if let p = pausedAt { pausedSec += Date().timeIntervalSince(p); pausedAt = nil }
        WKInterfaceDevice.current().play(.stop)
        let end = Date()
        // the cool-down: only with a workout recording heart rate, and not when the phone stopped it
        let wantsCoolDown = WatchStore.shared.snapshot?.watch.coolDown ?? true
        if wantsCoolDown, !fromPhone, session != nil, builder != nil {
            exitAt = end
            exitHR = heartRate
            session?.resume()
            phase = .coolDown
            startTicker()
            return
        }
        phase = .saving
        Task { await finish(at: end) }
    }

    /// Done on the cool-down screen, or 5 minutes after Stop.
    func endCoolDown() {
        guard phase == .coolDown, let exit = exitAt else { return }
        ticker?.invalidate()
        phase = .saving
        WKInterfaceDevice.current().play(.success)
        Task { await finish(at: exit) }
    }

    private func finish(at end: Date) async {
        guard let start = startDate else { phase = .idle; return }
        var workoutId: String?
        if let session, let builder {
            session.end()
            do {
                try await builder.endCollection(at: end)
                try await builder.addMetadata([
                    HKMetadataKeyIndoorWorkout: true,
                    HKMetadataKeyWorkoutBrandName: "Pepito Sauna",
                    "PepitoTemperatureC": tempC,
                    "PepitoSaunaType": "Sauna",
                    "PepitoRounds": rounds
                ])
                let workout = try await builder.finishWorkout()
                workoutId = workout?.uuid.uuidString
            } catch {
                workoutId = nil
            }
        }
        self.session = nil
        self.builder = nil

        let snap = WatchStore.shared.snapshot
        let maxHR = snap?.watch.maxHR ?? 190
        let floors = snap?.watch.zoneFloors ?? [0.5, 0.6, 0.7, 0.8, 0.9]
        let s0 = start.timeIntervalSince1970
        let s1 = end.timeIntervalSince1970
        let sum = SaunaHeartRate.summary(samples, start: s0, end: s1, maxHR: maxHR, floors: floors)
        let fiveSec = SaunaHeartRate.resample(samples, from: s0, to: s1)
        // the cool-down: from the last reading in the sauna, then everything after Stop
        var cool: [SaunaHeartRate.Sample] = []
        if exitAt != nil, !coolSamples.isEmpty {
            let lastIn = samples.filter { $0.t <= s1 }.max { $0.t < $1.t }
            let all = (lastIn.map { [$0] } ?? []) + coolSamples
            let to = min(s1 + SaunaHeartRate.coolDownSec, all.map(\.t).max() ?? s1)
            cool = SaunaHeartRate.resample(all, from: s1, to: to)
        }
        let drop = cool.isEmpty ? nil : SaunaHeartRate.coolDownDrop(cool, exit: s1)

        summary = Summary(start: start, end: end, tempC: tempC, rounds: rounds, avgHR: sum.avg, peakHR: sum.peak,
                          zoneMinutes: sum.zoneMinutes, samples: samples, activeSec: max(0, s1 - s0 - pausedSec),
                          coolDown: drop)
        lastWorkoutId = workoutId
        phase = .summary

        WatchStore.shared.send(PendingAction(
            type: .saunaCompleted, at: end, source: .watch,
            payload: .init(tempC: tempC, rounds: rounds, start: s0 * 1000, end: s1 * 1000, type: "Sauna",
                           avgHR: sum.avg, peakHR: sum.peak, samples: fiveSec.map { [$0.t, $0.bpm] },
                           roundSplits: roundSplits.map { $0.timeIntervalSince1970 * 1000 }, workoutId: workoutId,
                           exitAt: cool.isEmpty ? nil : s1 * 1000, coolDown: cool.isEmpty ? nil : cool.map { [$0.t, $0.bpm] })))
    }

    /// Done on the summary screen.
    func dismissSummary() {
        summary = nil
        phase = .idle
        startDate = nil
    }

    // MARK: - live heart rate

    fileprivate func record(bpm: Double, at date: Date) {
        heartRate = bpm
        if phase == .coolDown || phase == .saving, let exit = exitAt, date > exit {
            coolSamples.append(SaunaHeartRate.Sample(t: date.timeIntervalSince1970, bpm: bpm))
            return
        }
        if minuteHeartRate == nil { minuteHeartRate = bpm }
        let sample = SaunaHeartRate.Sample(t: date.timeIntervalSince1970, bpm: bpm)
        samples.append(sample)
        recent.append(sample)
        let cutoff = date.timeIntervalSince1970 - 600
        recent.removeAll { $0.t < cutoff }
    }

    var zone: Int? {
        guard let hr = heartRate, let snap = WatchStore.shared.snapshot else { return nil }
        return SaunaHeartRate.zone(bpm: hr, maxHR: snap.watch.maxHR, floors: snap.watch.zoneFloors)
    }
}

extension SaunaWorkoutManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState, date: Date) {}
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {}
}

extension SaunaWorkoutManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let hrType = HKQuantityType(.heartRate)
        guard collectedTypes.contains(hrType),
              let stats = workoutBuilder.statistics(for: hrType),
              let q = stats.mostRecentQuantity() else { return }
        let bpm = q.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        let at = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        Task { @MainActor in SaunaWorkoutManager.shared.record(bpm: bpm, at: at) }
    }
}
