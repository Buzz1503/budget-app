import Foundation
import CoreMotion
import HealthKit
import PepitoCore

/// The overnight movement recording (Sleep Lab, restlessness).
///
/// Each evening after 6 pm the Watch asks CMSensorRecorder for 12 hours of
/// accelerometer recording; the system records even while this app is not
/// running. Started on the first background refresh after 6 pm, again from
/// any launch, foreground or snapshot that finds none running. After waking,
/// the recording is read for the main sleep (from Health's sleep samples),
/// summarised here with `Restlessness`, and only the summary and a one-minute
/// movement series go to the iPhone. Raw accelerometer data never leaves the
/// Watch. Off in More > Health > Sleep (snapshot `sleep.restlessness`).
@MainActor
final class RestlessRecorder {
    static let shared = RestlessRecorder()

    private let recorder = CMSensorRecorder()
    private let health = HKHealthStore()
    private let defaults = UserDefaults.standard
    private let lastStartKey = "pepito.restless.lastStart"
    private let lastSentKey = "pepito.restless.lastSentWake"
    private var summarising = false

    private var enabled: Bool { WatchStore.shared.snapshot?.sleep?.restlessness ?? true }

    /// Start tonight's recording if it is due, and summarise last night if it is morning.
    func tick(now: Date = Date()) {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return }
        let last = defaults.object(forKey: lastStartKey) as? Date
        if RestlessRecording.shouldStart(now: now, lastStart: last, enabled: enabled) {
            recorder.recordAccelerometer(forDuration: RestlessRecording.durationH * 3600)
            defaults.set(now, forKey: lastStartKey)
        }
        let hour = Calendar.current.component(.hour, from: now)
        if enabled, hour >= 5, hour < 15 { Task { await summariseLastNight(now: now) } }
    }

    /// Read last night's recording for the main sleep and send the summary, once per wake-up date.
    func summariseLastNight(now: Date = Date()) async {
        guard !summarising else { return }
        summarising = true
        defer { summarising = false }
        guard let window = await mainSleep(before: now) else { return }
        let wake = RestlessRecording.wakeDate(window.end)
        guard defaults.string(forKey: lastSentKey) != wake else { return }
        // the recorder needs a few minutes before the latest data can be read
        guard now.timeIntervalSince(window.end) > 5 * 60 else { return }
        guard let list = recorder.accelerometerData(from: window.start, to: window.end) else { return }
        var acc = Restlessness.Accumulator()
        var it = NSFastEnumerationIterator(list)
        while let item = it.next() {
            guard let d = item as? CMRecordedAccelerometerData else { continue }
            acc.add(t: d.startDate.timeIntervalSince1970, x: d.acceleration.x, y: d.acceleration.y, z: d.acceleration.z)
        }
        let seconds = acc.finish()
        guard !seconds.isEmpty else { return }
        let summary = Restlessness.summary(seconds, start: window.start.timeIntervalSince1970, end: window.end.timeIntervalSince1970)
        WatchStore.shared.send(PendingAction(type: .restlessness, at: now, source: .watch, payload: .init(date: wake, restless: summary)))
        defaults.set(wake, forKey: lastSentKey)
    }

    /// The main sleep that ended in the last 18 hours, from Health's asleep samples.
    private func mainSleep(before now: Date) async -> (start: Date, end: Date)? {
        guard HKHealthStore.isHealthDataAvailable(), let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
        try? await health.requestAuthorization(toShare: [], read: [type])
        let predicate = HKQuery.predicateForSamples(withStart: now.addingTimeInterval(-18 * 3600), end: now, options: [])
        let samples: [HKCategorySample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, s, _ in
                cont.resume(returning: (s as? [HKCategorySample]) ?? [])
            }
            health.execute(q)
        }
        let asleep = samples.filter { $0.value != HKCategoryValueSleepAnalysis.inBed.rawValue && $0.value != HKCategoryValueSleepAnalysis.awake.rawValue }
        return RestlessRecording.mainSleep(asleep.map { (start: $0.startDate, end: $0.endDate) })
    }
}
