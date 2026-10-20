import Foundation
import PepitoCore

/// What starting or stopping a sauna session does beyond queueing it: the Live
/// Activity (M4) and the Watch workout (M5). The sauna intents call this; as
/// Live Activity intents they always run in the app's process.
enum SaunaEffects {
    static func started(at: Date, targetMin: Int, tempC: Int) async {
        await MainActor.run { SaunaActivityController.shared.start(startedAt: at, targetMin: targetMin, tempC: tempC) }
    }

    static func stopped() async {
        await MainActor.run { SaunaActivityController.shared.endAll() }
    }
}
