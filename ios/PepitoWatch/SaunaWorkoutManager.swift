import Foundation
import HealthKit
import WatchKit
import PepitoCore

/// The sauna on the wrist: an indoor "other" workout session with a live
/// builder, so heart rate is recorded the whole time and the session is saved
/// to Health with its metadata. Haptics at every 5-minute mark and a stronger
/// one at the target; a round split on Next round (or the Ultra's Action
/// Button). Stop saves the workout and sends the session to the phone, which
/// adds it to the app (source Watch, linked to the workout) with the full
/// heart-rate series, so it is never offered as "Was this a sauna?".
@MainActor
final class SaunaWorkoutManager: NSObject, ObservableObject {
    static let shared = SaunaWorkoutManager()

    enum Phase: Equatable { case idle, running, saving, summary }

    struct Summary: Equatable {
        var start: Date
        var end: Date
        var tempC: Int
        var rounds: Int
        var avgHR: Int?
        var peakHR: Int?
        var zoneMinutes: [Double]
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var heartRate: Double?
    @Published private(set) var startDate: Date?
    @Published private(set) var targetMin = 20
    @Published private(set) var tempC = 60
    @Published private(set) var roundSplits: [Date] = []
    @Published private(set) var summary: Summary?

    private let health = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var samples: [SaunaHeartRate.Sample] = []
    private var ticker: Timer?
    private var lastElapsed: TimeInterval = 0
    private var targetBuzzed = false
    private var stoppedFromPhone = false

    var rounds: Int { roundSplits.count + 1 }
    var isRunning: Bool { phase == .running }

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
        heartRate = nil
        targetBuzzed = false
        lastElapsed = 0
        stoppedFromPhone = false

        let start = Date()
        startDate = start
        phase = .running

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
    }

    // MARK: - haptics

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard isRunning, let start = startDate else { return }
        let elapsed = Date().timeIntervalSince(start)
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
        phase = .saving
        let end = Date()
        Task { await finish(at: end) }
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

        summary = Summary(start: start, end: end, tempC: tempC, rounds: rounds, avgHR: sum.avg, peakHR: sum.peak, zoneMinutes: sum.zoneMinutes)
        phase = .summary

        WatchStore.shared.send(PendingAction(
            type: .saunaCompleted, at: end, source: .watch,
            payload: .init(tempC: tempC, rounds: rounds, start: s0 * 1000, end: s1 * 1000, type: "Sauna",
                           avgHR: sum.avg, peakHR: sum.peak, samples: fiveSec.map { [$0.t, $0.bpm] },
                           roundSplits: roundSplits.map { $0.timeIntervalSince1970 * 1000 }, workoutId: workoutId)))
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
        samples.append(.init(t: date.timeIntervalSince1970, bpm: bpm))
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
