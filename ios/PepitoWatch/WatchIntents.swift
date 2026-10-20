import AppIntents
import PepitoCore

// Siri on the Watch, and the Apple Watch Ultra Action Button.

/// The Ultra's Action Button (Settings › Action Button › Workout › Pepito+).
/// One press starts a sauna session with the usual length and temperature;
/// pressed again while it runs, it marks the next round, as the Workout app does.
struct StartSaunaWorkoutIntent: StartWorkoutIntent {
    static var title: LocalizedStringResource = "Start sauna"
    static var description = IntentDescription("Start a sauna session with your usual length and temperature.")

    enum WorkoutStyle: String, AppEnum {
        case sauna
        static var typeDisplayRepresentation: TypeDisplayRepresentation = "Session"
        static var caseDisplayRepresentations: [WorkoutStyle: DisplayRepresentation] = [.sauna: "Sauna"]
    }

    @Parameter(title: "Session") var workoutStyle: WorkoutStyle

    static var suggestedWorkouts: [StartSaunaWorkoutIntent] { [StartSaunaWorkoutIntent(style: .sauna)] }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "Sauna", subtitle: "Pepito+", image: .init(systemName: "flame"))
    }

    init() { workoutStyle = .sauna }
    init(style: WorkoutStyle) { workoutStyle = style }

    @MainActor
    func perform() async throws -> some IntentResult {
        WatchStore.shared.launch = .sauna
        await SaunaWorkoutManager.shared.startOrNextRound()
        return .result()
    }
}

struct WatchStartSaunaIntent: AppIntent {
    static var title: LocalizedStringResource = "Start sauna"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        if SaunaWorkoutManager.shared.isRunning { return .result(dialog: "A sauna session is already running.") }
        WatchStore.shared.launch = .sauna
        await SaunaWorkoutManager.shared.start()
        let m = SaunaWorkoutManager.shared
        return .result(dialog: "Sauna started: \(m.targetMin) min at \(m.tempC) C.")
    }
}

struct WatchStopSaunaIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop sauna"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard SaunaWorkoutManager.shared.isRunning else { return .result(dialog: "No sauna session is running.") }
        SaunaWorkoutManager.shared.stop()
        return .result(dialog: "Sauna saved.")
    }
}

struct WatchLogDueDosesIntent: AppIntent {
    static var title: LocalizedStringResource = "Log my doses"
    static var openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = WatchStore.shared.snapshot else { return .result(dialog: "Open Pepito+ on your iPhone once first.") }
        let due = DoseBoard.dueNow(s, now: Date())
        guard !due.rows.isEmpty else { return .result(dialog: "Nothing due in \(due.slot.title).") }
        WatchStore.shared.logAllDue()
        let n = due.rows.flatMap(\.items).count
        return .result(dialog: "Logged \(n) \(n == 1 ? "item" : "items") from \(due.slot.title).")
    }
}

struct PepitoWatchShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: WatchStartSaunaIntent(), phrases: ["Start sauna in \(.applicationName)"],
                    shortTitle: "Start sauna", systemImageName: "flame")
        AppShortcut(intent: WatchStopSaunaIntent(), phrases: ["Stop sauna in \(.applicationName)"],
                    shortTitle: "Stop sauna", systemImageName: "stop.circle")
        AppShortcut(intent: WatchLogDueDosesIntent(), phrases: ["Log my doses in \(.applicationName)"],
                    shortTitle: "Log my doses", systemImageName: "checkmark.circle")
    }
}
