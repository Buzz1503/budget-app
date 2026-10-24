import AppIntents
import PepitoCore

// Sleep sounds as Shortcuts actions, for a Personal Automation set to Run
// Immediately: "When Sleep Focus turns on, Start sleep sounds", or "When
// iPhone connects to power" with Only after 8 pm, and "When Sleep Focus turns
// off, Stop sleep sounds". App target only: the engine lives in the app.

struct StartSleepSoundsIntent: AppIntent {
    static var title: LocalizedStringResource = "Start sleep sounds"
    static var description = IntentDescription("Start listening for snoring, coughing and sleep talking. Keeps the time and kind of sound only; no audio is saved.")
    /// The microphone can only be started from the foreground: the app opens
    /// for a moment, then keeps listening in the background with the screen locked.
    static var openAppWhenRun = true

    @Parameter(title: "Only after 8 pm", description: "For the charger automation: does nothing between 4 am and 8 pm.", default: false)
    var eveningOnly: Bool

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        if eveningOnly && !SleepSoundsCore.inEveningWindow(Date()) {
            return .result(dialog: "Sleep sounds starts after 8 pm.")
        }
        if SleepSoundsEngine.shared.isRunning { return .result(dialog: "Sleep sounds is already listening.") }
        guard SleepSoundsEngine.shared.start(by: "shortcut") else {
            return .result(dialog: "Sleep sounds needs microphone access. Open Pepito+ to allow it.")
        }
        PepitoBridgePlugin.emit("sleepSoundsChanged", ["running": true])
        return .result(dialog: "Sleep sounds is listening.")
    }
}

struct StopSleepSoundsIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop sleep sounds"
    static var description = IntentDescription("Stop listening and keep last night's sounds.")
    static var openAppWhenRun = false

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard SleepSoundsEngine.shared.isRunning else { return .result(dialog: "Sleep sounds was not running.") }
        SleepSoundsEngine.shared.stop(reason: SleepSoundsCore.StopReason.focusOff.rawValue)
        return .result(dialog: "Sleep sounds stopped.")
    }
}
