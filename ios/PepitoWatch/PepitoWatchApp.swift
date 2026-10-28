import SwiftUI
import WatchKit
import HealthKit
import UserNotifications
import WidgetKit
import PepitoCore
import PepitoTheme
import PepitoWatchUI

@main
struct PepitoWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @StateObject private var store = WatchStore.shared
    @StateObject private var sauna = SaunaWorkoutManager.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(sauna)
                .environment(\.watchMetrics, WatchMetrics(width: WKInterfaceDevice.current().screenBounds.width))
                .onOpenURL { url in
                    // complications and the Smart Stack open their own screen
                    if let route = WatchRoute.from(url: url) { store.open(route) }
                }
        }
    }
}

/// Home, a menu of Doses, Sauna, Readiness and Sleep, one tap from each. The
/// exceptions: while a sauna session runs (or its summary waits), the app
/// opens straight to it; after Start sleep, straight to the night screen.
struct RootView: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $store.path) {
            HomeScreen()
                .navigationDestination(for: WatchRoute.self) { route in
                    switch route {
                    case .doses: DosesScreen()
                    case .sauna: SaunaScreen()
                    case .readiness: ReadinessScreen()
                    case .evening: EveningScreen()
                    case .sleep: SleepScreen()
                    }
                }
        }
        .tint(PepitoTheme.Palette.text)
        .onAppear { showSessionIfRunning() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { showSessionIfRunning(); store.refreshSyncState() }
        }
        .overlay(alignment: .top) {
            if let b = store.banner {
                Text(b)
                    .font(.system(size: 13, weight: .medium))
                    .padding(PepitoTheme.Space.s8)
                    .background(Capsule().fill(PepitoTheme.Palette.surfaceSolid))
                    .onTapGesture { store.banner = nil }
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); store.banner = nil }
            }
        }
    }

    private func showSessionIfRunning() {
        let path = WatchRoute.launchPath(saunaRunning: sauna.isRunning || sauna.phase == .coolDown || sauna.phase == .saving || sauna.phase == .summary,
                                         sleeping: SleepMode.isSleeping(store.sleepNight, now: Date()))
        if !path.isEmpty, store.path != path { store.path = path }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in
            WatchStore.shared.activate()
            RestlessRecorder.shared.tick()
            WatchSelfCheck.run()
        }
        UNUserNotificationCenter.current().delegate = self
        WatchAppDelegate.registerCategories()
        scheduleRefresh()
    }

    func applicationDidBecomeActive() {
        Task { @MainActor in RestlessRecorder.shared.tick(); WatchSelfCheck.run() }
    }

    /// Background refresh: start the evening's movement recording, summarise
    /// the night, and at the evening prompt check the battery.
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let refresh = task as? WKApplicationRefreshBackgroundTask {
                Task { @MainActor in
                    RestlessRecorder.shared.tick()
                    await RestlessRecorder.shared.summariseLastNight()
                    WatchSelfCheck.run()
                    self.scheduleRefresh()
                    refresh.setTaskCompletedWithSnapshot(false)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    /// The recording's own schedule, or the next evening prompt if that comes first.
    private func scheduleRefresh() {
        let now = Date()
        var next = RestlessRecording.nextRefresh(after: now)
        if let evening = WatchStore.shared.snapshot?.sleep?.nextEveningDate, evening > now, evening < next { next = evening.addingTimeInterval(60) }
        WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: next, userInfo: nil) { _ in }
    }

    /// The iPhone started a sauna session and launched this app into its workout.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in
            WatchStore.shared.open(.sauna)
            await SaunaWorkoutManager.shared.start(startedOnPhone: true)
        }
    }

    // Dose reminders here (the Watch's own, and the iPhone's when it forwards
    // them) have Log all, Skip and Remind in 30 min. A button pressed on the
    // Watch is handled like a tap in the Watch app.
    static func registerCategories() {
        let took = SharedStore.shared().readSnapshot()?.sleep?.took?.short
        let cats = NotificationAction.watchCategories(took: took).map { id, buttons in
            UNNotificationCategory(identifier: id,
                                   actions: buttons.map { UNNotificationAction(identifier: $0.0, title: $0.1, options: $0.2 ? [.foreground] : []) },
                                   intentIdentifiers: [], options: [])
        }
        UNUserNotificationCenter.current().setNotificationCategories(Set(cats))
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let payload = NotificationPayload.from(userInfo: response.notification.request.content.userInfo)
        let button = response.actionIdentifier
        Task { @MainActor in
            if let p = payload {
                let actions = NotificationAction.actions(for: button, payload: p)
                    .map { a -> PendingAction in var x = a; x.source = .watch; return x }
                WatchStore.shared.send(actions)
                if button == UNNotificationDefaultActionIdentifier, p.kind == "dose" { WatchStore.shared.open(.doses) }
                if button == NotificationAction.eveningLog { WatchStore.shared.open(.evening) }
                // the morning check: dreams next, one tap
                if let next = NotificationAction.followUp(for: button, payload: p) {
                    let c = UNMutableNotificationContent()
                    c.title = next.title
                    c.body = next.body
                    c.categoryIdentifier = next.category
                    c.threadIdentifier = "pepito.sleep"
                    c.userInfo = [NotificationPayload.userInfoKey: next.payload.json()]
                    try? await UNUserNotificationCenter.current().add(
                        UNNotificationRequest(identifier: next.id, content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
                }
            }
            if button == NotificationAction.stopSauna { SaunaWorkoutManager.shared.stop() }
            if button == NotificationAction.snooze {
                // remind again in 30 minutes, here on the wrist
                let original = response.notification.request.content
                let c = UNMutableNotificationContent()
                c.title = original.title
                c.body = original.body
                c.sound = .default
                c.categoryIdentifier = original.categoryIdentifier
                c.threadIdentifier = original.threadIdentifier
                c.userInfo = original.userInfo
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(NotificationAction.snoozeMinutes * 60), repeats: false)
                try? await UNUserNotificationCenter.current().add(
                    UNNotificationRequest(identifier: "\(NotificationAction.snoozePrefix)\(payload?.date ?? "").\(payload?.slot ?? "")", content: c, trigger: trigger))
            }
            completionHandler()
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

/// Two checks the Watch makes on itself: whether a Pepito complication is on
/// the face and the battery level, reported to the iPhone for Sleep setup when
/// either changes; and, at the evening prompt, a nudge to charge when the
/// battery is under 30% so the night can be recorded.
@MainActor
enum WatchSelfCheck {
    private static let lastReportKey = "pepito.watch.lastReport"
    private static let lastNudgeKey = "pepito.watch.lastBatteryNudge"

    static func run(now: Date = Date()) {
        let device = WKInterfaceDevice.current()
        device.isBatteryMonitoringEnabled = true
        let battery = Double(device.batteryLevel)
        WidgetCenter.shared.getCurrentConfigurations { result in
            let on = (try? result.get())?.isEmpty == false
            Task { @MainActor in report(complication: on, battery: battery, now: now) }
        }
        nudge(battery: battery, now: now)
    }

    private static func report(complication: Bool, battery: Double, now: Date) {
        guard battery >= 0 else { return }
        let d = UserDefaults.standard
        let last = d.data(forKey: lastReportKey).flatMap { try? JSONDecoder().decode(WatchStatusReport.Last.self, from: $0) }
        guard WatchStatusReport.shouldSend(last: last, complication: complication, battery: battery, now: now) else { return }
        WatchStore.shared.send(WatchStatusReport.action(complication: complication, battery: battery, now: now))
        if let data = try? JSONEncoder().encode(WatchStatusReport.Last(complication: complication, battery: battery, at: now)) {
            d.set(data, forKey: lastReportKey)
        }
    }

    private static func nudge(battery: Double, now: Date) {
        let d = UserDefaults.standard
        // the latest evening prompt that has already come
        let evening = [WatchStore.shared.snapshot?.sleep?.nextEveningDate, previousEvening(now: now)]
            .compactMap { $0 }.filter { $0 <= now }.max()
        guard BedtimeNudge.shouldNudge(battery: battery, now: now, eveningAt: evening, lastNudged: d.string(forKey: lastNudgeKey)),
              let at = evening else { return }
        let c = UNMutableNotificationContent()
        c.title = BedtimeNudge.title
        c.body = BedtimeNudge.body(battery: battery)
        c.sound = .default
        c.threadIdentifier = "pepito.sleep"
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "pepito.battery.\(DoseBoard.dateString(at))", content: c, trigger: nil))
        d.set(DoseBoard.dateString(at), forKey: lastNudgeKey)
    }

    /// Once the evening prompt has passed the snapshot's next one is tomorrow's: the one
    /// just gone is remembered when the snapshot is replaced.
    private static func previousEvening(now: Date) -> Date? {
        UserDefaults.standard.object(forKey: "pepito.watch.lastEvening") as? Date
    }

    /// Remember tonight's prompt time before a newer snapshot moves it to tomorrow.
    static func remember(_ snap: Snapshot?) {
        if let e = snap?.sleep?.nextEveningDate { UserDefaults.standard.set(e, forKey: "pepito.watch.lastEvening") }
    }
}
