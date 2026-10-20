import SwiftUI
import WatchKit
import HealthKit
import UserNotifications
import PepitoCore
import PepitoTheme

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
                .onOpenURL { url in
                    // the sauna complication opens straight into the Sauna start screen
                    if url.host == "sauna" { store.launch = .sauna }
                }
        }
    }
}

/// Opens to the most useful screen: a running session, else doses still due
/// in this slot, else readiness. Recomputed each time the app comes forward.
struct RootView: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var sauna: SaunaWorkoutManager
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $store.launch) {
            TodayTab().tag(WatchLaunch.today)
            SaunaTab().tag(WatchLaunch.sauna)
            ReadinessTab().tag(WatchLaunch.readiness)
        }
        .tabViewStyle(.verticalPage)
        .background(PepitoTheme.Palette.bg)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                store.launch = sauna.isRunning || sauna.phase == .summary ? .sauna : WatchLaunch.screen(for: store.snapshot, now: Date())
            }
        }
        .overlay(alignment: .top) {
            if let b = store.banner {
                Text(b)
                    .font(PepitoTheme.Typography.small)
                    .padding(PepitoTheme.Space.s8)
                    .background(Capsule().fill(PepitoTheme.Palette.surfaceSolid))
                    .onTapGesture { store.banner = nil }
                    .task { try? await Task.sleep(nanoseconds: 3_000_000_000); store.banner = nil }
            }
        }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in WatchStore.shared.activate() }
        UNUserNotificationCenter.current().delegate = self
        registerCategories()
    }

    /// The iPhone started a sauna session and launched this app into its workout.
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in
            WatchStore.shared.launch = .sauna
            await SaunaWorkoutManager.shared.start(startedOnPhone: true)
        }
    }

    // Reminders from the iPhone show here with the same buttons. A button
    // pressed on the Watch is handled like a tap in the Watch app.
    private func registerCategories() {
        let cats = NotificationAction.categories.map { id, buttons in
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
