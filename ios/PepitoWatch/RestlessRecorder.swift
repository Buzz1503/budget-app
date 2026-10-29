import Foundation
import CoreMotion
import HealthKit
import PepitoCore

/// The overnight movement recording (Sleep Lab, restlessness).
///
/// CMSensorRecorder records only for the window it was asked for, so a fresh
/// 12 hours is asked for on every run of the app, every snapshot, Sleep sounds
/// starting (or its 9 pm schedule) on the iPhone and Start sleep
/// (`RestlessStart.request`). Each run then reads every night of the last three
/// days that has not been sent yet (the recorder keeps three days), at any
/// hour, so a morning without the app running no longer loses its night. Each
/// night is the main sleep from Health's sleep samples, read in pieces of at
/// most 12 hours, summarised here with `Restlessness`, and only the summary and
/// a one-minute movement series go to the iPhone. Raw accelerometer data never
/// leaves the Watch. Off in More > Health > Sleep (snapshot `sleep.restlessness`).
@MainActor
final class RestlessRecorder {
    static let shared = RestlessRecorder()

    private let recorder = CMSensorRecorder()
    private let health = HKHealthStore()
    private let defaults = UserDefaults.standard
    private let sentKey = "pepito.restless.sentWakes"
    private let lastResultKey = "pepito.restless.lastResult"
    private var summarising = false

    private var enabled: Bool { WatchStore.shared.snapshot?.sleep?.restlessness ?? true }

    /// What the last read found, for the report to the iPhone.
    var lastResult: String? { defaults.string(forKey: lastResultKey) }

    /// Ask for a fresh window, then send any night not sent yet.
    func tick(_ trigger: RestlessRecording.Trigger = .appRun, now: Date = Date()) {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return }
        RestlessStart.request(trigger, enabled: enabled, now: now)
        if enabled { Task { await summariseRecent(now: now) } }
    }

    private var sent: Set<String> {
        get { Set(defaults.stringArray(forKey: sentKey) ?? []) }
        set { defaults.set(Array(newValue.sorted().suffix(14)), forKey: sentKey) }
    }

    /// Read every unsent night of the last three days and send its summary.
    func summariseRecent(now: Date = Date()) async {
        guard !summarising else { return }
        summarising = true
        defer { summarising = false }
        let samples = await asleepSamples(since: now.addingTimeInterval(-RestlessRecording.keepDays * 86400), now: now)
        let nights = RestlessRecording.nightsToSend(samples, sent: sent, now: now)
        if nights.isEmpty { defaults.set(samples.isEmpty ? "noSleep" : "upToDate", forKey: lastResultKey); return }
        for n in nights {
            var acc = Restlessness.Accumulator()
            for piece in RestlessRecording.chunks(start: n.start, end: n.end) {
                guard let list = recorder.accelerometerData(from: piece.start, to: piece.end) else { continue }
                var it = NSFastEnumerationIterator(list)
                while let item = it.next() {
                    guard let d = item as? CMRecordedAccelerometerData else { continue }
                    acc.add(t: d.startDate.timeIntervalSince1970, x: d.acceleration.x, y: d.acceleration.y, z: d.acceleration.z)
                }
            }
            let seconds = acc.finish()
            // nothing recorded for this night: try again on the next run while the recorder still has it
            guard !seconds.isEmpty else { defaults.set("noData", forKey: lastResultKey); continue }
            let summary = Restlessness.summary(seconds, start: n.start.timeIntervalSince1970, end: n.end.timeIntervalSince1970)
            WatchStore.shared.send(PendingAction(type: .restlessness, at: now, source: .watch, payload: .init(date: n.wake, restless: summary)))
            var s = sent
            s.insert(n.wake)
            sent = s
            defaults.set("sent", forKey: lastResultKey)
        }
    }

    /// The same, waited for (a background refresh completes only after it).
    func refresh(_ trigger: RestlessRecording.Trigger = .appRun, now: Date = Date()) async {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return }
        RestlessStart.request(trigger, enabled: enabled, now: now)
        if enabled { await summariseRecent(now: now) }
    }

    /// Health's asleep samples since a date.
    private func asleepSamples(since: Date, now: Date) async -> [(start: Date, end: Date)] {
        guard HKHealthStore.isHealthDataAvailable(), let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return [] }
        try? await health.requestAuthorization(toShare: [], read: [type])
        let predicate = HKQuery.predicateForSamples(withStart: since, end: now, options: [])
        let samples: [HKCategorySample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, s, _ in
                cont.resume(returning: (s as? [HKCategorySample]) ?? [])
            }
            health.execute(q)
        }
        return samples
            .filter { $0.value != HKCategoryValueSleepAnalysis.inBed.rawValue && $0.value != HKCategoryValueSleepAnalysis.awake.rawValue }
            .map { (start: $0.startDate, end: $0.endDate) }
    }
}
