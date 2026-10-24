import SwiftUI
import WatchKit
import HealthKit
import UserNotifications
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

/// Home, a menu of Doses, Sauna and Readiness, one tap from each. The one
/// exception: while a sauna session runs (or its summary waits), the app
/// opens straight to it.
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
        let path = WatchRoute.launchPath(saunaRunning: sauna.isRunning || sauna.phase == .coolDown || sauna.phase == .saving || sauna.phase == .summary)
        if !path.isEmpty, store.path != path { store.path = path }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in
            WatchStore.shared.activate()
            RestlessRecorder.shared.tick()
        }
        UNUserNotificationCenter.current().delegate = self
        registerCategories()
        scheduleRefresh()
    }

    func applicationDidBecomeActive() {
        Task { @MainActor in RestlessRecorder.shared.tick() }
    }

    /// Background refresh: start the evening's movement recording, or summarise the night.
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        for task in backgroundTasks {
            if let refresh = task as? WKApplicationRefreshBackgroundTask {
                Task { @MainActor in
                    RestlessRecorder.shared.tick()
                    await RestlessRecorder.shared.summariseLastNight()
                    self.scheduleRefresh()
                    refresh.setTaskCompletedWithSnapshot(false)
                }
            } else {
                task.setTaskCompletedWithSnapshot(false)
            }
        }
    }

    private func scheduleRefresh() {
        WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: RestlessRecording.nextRefresh(after: Date()), userInfo: nil) { _ in }
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
    private func registerCategories() {
        let cats = NotificationAction.watchCategories.map { id, buttons in
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
