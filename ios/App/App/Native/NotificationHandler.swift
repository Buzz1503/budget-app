import Foundation
import UserNotifications
import PepitoCore

/// The app's notification delegate (Capacitor's own handling is switched off in
/// capacitor.config.json, ios.handleApplicationNotifications = false).
///
/// Log, Take, Skip, Remind in 30 min, Push to tomorrow and the stock answers (Yes,
/// Still some left, Not yet, Remind me in 3 days) run in the background
/// without opening the app: each becomes a queued action through ActionSink,
/// and the web layer applies it the next time it runs. Check now and Open Stock
/// open the app on that screen. The same buttons appear on the Apple Watch
/// when the iPhone is locked, and are handled here too.
final class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationHandler()

    func install() {
        UNUserNotificationCenter.current().delegate = self
        PepitoNotifications.registerCategories()
    }

    /// In the foreground a reminder still shows as a banner.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        let payload = NotificationPayload.from(userInfo: content.userInfo)
        let button = response.actionIdentifier

        switch button {
        case NotificationAction.log, NotificationAction.take, NotificationAction.skip, NotificationAction.push:
            if let p = payload { ActionSink.record(NotificationAction.actions(for: button, payload: p)) }
        case NotificationAction.vialYes, NotificationAction.vialStill, NotificationAction.vialNotYet, NotificationAction.orderSnooze:
            // the answer to a stock question: queued, and applied by the web layer once
            if let p = payload { ActionSink.record(NotificationAction.actions(for: button, payload: p)) }
        case NotificationAction.took, NotificationAction.eveningNothing:
            if let p = payload { ActionSink.record(NotificationAction.actions(for: button, payload: p)) }
        case NotificationAction.eveningLog:
            RouteBox.open("evening")
        case _ where button.hasPrefix(NotificationAction.restedPrefix) || button.hasPrefix(NotificationAction.dreamsPrefix):
            // the morning check, one tap each: rested, then dreams as its own notification
            if let p = payload {
                ActionSink.record(NotificationAction.actions(for: button, payload: p))
                if let next = NotificationAction.followUp(for: button, payload: p) { PepitoNotifications.post(followUp: next) }
            }
        case NotificationAction.openCount:
            RouteBox.open("count")
        case NotificationAction.snooze:
            if let p = payload {
                PepitoNotifications.snooze(content, payload: p)
                ActionSink.record(NotificationAction.actions(for: button, payload: p))
            }
        case NotificationAction.stopSauna:
            ActionSink.record(PendingAction(type: .stopSauna, source: .notification,
                                            payload: .init(stoppedAt: Date().timeIntervalSince1970 * 1000)))
            SaunaActivityController.shared.endAll()
        case NotificationAction.openStock:
            RouteBox.open("supplies")
        case NotificationAction.openReaction:
            RouteBox.open("reactions")
        case UNNotificationDefaultActionIdentifier where (content.userInfo["pepito.sounds"] as? String) == "start":
            // "Tap to start Sleep sounds": the web layer starts it in the foreground, where iOS allows the microphone
            SleepSoundsEngine.shared.pendingStart = true
            RouteBox.open("sounds")
        case UNNotificationDefaultActionIdentifier:
            // a tap on the banner opens the app where it belongs
            RouteBox.open(payload?.route ?? "today")
        default:
            break
        }
        completionHandler()
    }
}

/// Where the next screen should be when the web layer asks: set by a
/// notification tap, which can arrive before the web view has loaded.
enum RouteBox {
    private static let key = "pepito.pendingRoute"

    static func open(_ route: String) {
        UserDefaults.standard.set(route, forKey: key)
        PepitoBridgePlugin.emit("openRoute", ["route": route])
    }

    static func take() -> String? {
        let r = UserDefaults.standard.string(forKey: key)
        UserDefaults.standard.removeObject(forKey: key)
        return r
    }
}
