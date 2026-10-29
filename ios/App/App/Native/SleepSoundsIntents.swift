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
        let now = Date().timeIntervalSince1970 * 1000
        if eveningOnly && !SleepSoundsCore.inEveningWindow(Date()) {
            SleepSoundsEngine.shared.record(.init(at: now, kind: "start", by: "shortcut", result: "skippedDaytime"))
            return .result(dialog: "Sleep sounds starts after 8 pm.")
        }
        if SleepSoundsEngine.shared.isRunning {
            SleepSoundsEngine.shared.record(.init(at: now, kind: "start", by: "shortcut", result: SleepSoundsCore.StartResult.alreadyRunning.rawValue))
            return .result(dialog: "Sleep sounds is already listening.")
        }
        let entry = SleepSoundsEngine.shared.startWithResult(by: "shortcut")
        guard entry.result == SleepSoundsCore.StartResult.started.rawValue else {
            let words = SleepSoundsCore.StartResult(rawValue: entry.result).map(SleepSoundsCore.startFailureWords) ?? ""
            let text = "Sleep sounds could not start. \(words) A notification will let you start it."
            return .result(dialog: IntentDialog(stringLiteral: text))
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
        guard SleepSoundsEngine.shared.isRunning else {
            // never a bare "was not running": say when it stopped or why it never started
            SleepSoundsEngine.shared.record(.init(at: Date().timeIntervalSince1970 * 1000, kind: "stop", by: "shortcut", result: "notRunning"))
            return .result(dialog: IntentDialog(stringLiteral: SleepSoundsEngine.shared.notRunningWords()))
        }
        SleepSoundsEngine.shared.stop(reason: SleepSoundsCore.StopReason.focusOff.rawValue)
        return .result(dialog: "Sleep sounds stopped.")
    }
}

/// The scheduled start, for a Time of Day automation at 9 pm. On iOS 18 and later it is an
/// AudioRecordingIntent: it starts the microphone with the phone locked, without opening the
/// app, and keeps the Sleep sounds Live Activity on screen while it listens. If iOS will not
/// let it start (permission, Low Power Mode, an audio error), the start is logged with its
/// reason and a time-sensitive notification asks for a tap.
@available(iOS 18.0, *)
struct StartSleepSoundsScheduledIntent: AudioRecordingIntent {
    static var title: LocalizedStringResource = "Start sleep sounds on schedule"
    static var description = IntentDescription("For a 9 pm Time of Day automation. Starts listening with the phone locked and shows a Live Activity until the scheduled stop. No audio is saved.")
    static var openAppWhenRun = false

    init() {}

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let e = SleepSoundsEngine.shared
        // the schedule firing is also the Watch's cue for a fresh movement window, whatever happens to the start
        WatchLink.shared.sendCommand(RestlessRecording.message(.schedule, at: Date()))
        if !SleepSoundsCore.shouldStartOnSchedule(isRunning: e.isRunning) {
            // already listening (started by hand or by Sleep Focus): nothing to do
            e.record(.init(at: Date().timeIntervalSince1970 * 1000, kind: "start", by: "schedule", result: SleepSoundsCore.StartResult.alreadyRunning.rawValue))
            return .result(dialog: "Sleep sounds is already listening.")
        }
        let entry = e.startWithResult(by: "schedule")
        guard entry.result == SleepSoundsCore.StartResult.started.rawValue else {
            return .result(dialog: "Sleep sounds could not start. A notification will let you start it.")
        }
        PepitoBridgePlugin.emit("sleepSoundsChanged", ["running": true])
        let text = "Sleep sounds is listening \(e.schedule.untilWords)."
        return .result(dialog: IntentDialog(stringLiteral: text))
    }
}
