import Foundation
import HealthKit
import PepitoCore

/// What starting or stopping a sauna session does beyond queueing it: the Live
/// Activity, and the Watch. Starting on the iPhone also starts the Watch app's
/// sauna workout through HealthKit when the Watch app is installed, so one
/// press records heart rate on the wrist; stopping on the iPhone stops it. The
/// sauna intents call this; as Live Activity intents they always run in the
/// app's process.
enum SaunaEffects {
    private static let health = HKHealthStore()

    static func started(at: Date, targetMin: Int, tempC: Int) async {
        await MainActor.run { SaunaActivityController.shared.start(startedAt: at, targetMin: targetMin, tempC: tempC) }
        startWatchWorkout()
    }

    static func stopped() async {
        await MainActor.run { SaunaActivityController.shared.endAll() }
        WatchLink.shared.sendCommand(["command": "stopSauna"])
    }

    /// Launches the Watch app into its sauna workout. The Watch reads the
    /// target and temperature from the snapshot it already has.
    static func startWatchWorkout() {
        guard HKHealthStore.isHealthDataAvailable(), WatchLink.shared.isWatchAppInstalled else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .indoor
        health.startWatchApp(with: config) { _, _ in }
    }
}
