import AppIntents

/// The phrases Siri, Spotlight, Shortcuts and the Action Button offer without
/// any setup. "Pepito" works as well as "Pepito+" (INAlternativeAppNames in Info.plist).
struct PepitoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSaunaIntent(),
            phrases: ["Start sauna in \(.applicationName)", "Start a sauna in \(.applicationName)"],
            shortTitle: "Start sauna",
            systemImageName: "flame")
        AppShortcut(
            intent: StopSaunaIntent(),
            phrases: ["Stop sauna in \(.applicationName)", "Stop the sauna in \(.applicationName)"],
            shortTitle: "Stop sauna",
            systemImageName: "stop.circle")
        AppShortcut(
            intent: LogDueDosesIntent(),
            phrases: ["Log my doses in \(.applicationName)", "Log my protocol in \(.applicationName)"],
            shortTitle: "Log my doses",
            systemImageName: "checkmark.circle")
        AppShortcut(
            intent: ShowReadinessIntent(),
            phrases: ["What's my readiness in \(.applicationName)", "Show my readiness in \(.applicationName)"],
            shortTitle: "Readiness",
            systemImageName: "gauge.with.dots.needle.67percent")
        AppShortcut(
            intent: LogDoseIntent(),
            phrases: ["Log a dose in \(.applicationName)"],
            shortTitle: "Log a dose",
            systemImageName: "syringe")
        AppShortcut(
            intent: StartSleepSoundsIntent(),
            phrases: ["Start sleep sounds in \(.applicationName)"],
            shortTitle: "Start sleep sounds",
            systemImageName: "waveform")
        AppShortcut(
            intent: StopSleepSoundsIntent(),
            phrases: ["Stop sleep sounds in \(.applicationName)"],
            shortTitle: "Stop sleep sounds",
            systemImageName: "waveform.slash")
        AppShortcut(
            intent: SkipDoseIntent(),
            phrases: ["Skip a dose in \(.applicationName)"],
            shortTitle: "Skip a dose",
            systemImageName: "forward")
    }
}
