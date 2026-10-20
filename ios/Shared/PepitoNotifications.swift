import Foundation
import UserNotifications
import PepitoCore

/// Local notifications: categories, the rolling schedule the web layer
/// builds, snoozes, and pruning reminders a widget or Watch tick has made stale.
/// Compiled into the app and the widget extension (which prunes after a tick).
enum PepitoNotifications {
    static var center: UNUserNotificationCenter { .current() }

    /// The categories and their buttons. Background buttons are handled without
    /// opening the app; Check now and Open Stock open it.
    static func registerCategories() {
        let cats = NotificationAction.categories.map { id, buttons in
            UNNotificationCategory(
                identifier: id,
                actions: buttons.map { bid, title, opens in
                    UNNotificationAction(identifier: bid, title: title, options: opens ? [.foreground] : [])
                },
                intentIdentifiers: [],
                options: [])
        }
        center.setNotificationCategories(Set(cats))
    }

    static func content(title: String, body: String, category: String, thread: String, timeSensitive: Bool,
                        payload: NotificationPayload) -> UNMutableNotificationContent {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        c.categoryIdentifier = category
        c.threadIdentifier = thread
        c.userInfo = [NotificationPayload.userInfoKey: payload.json()]
        if timeSensitive && NativeFeatures.timeSensitive {
            c.interruptionLevel = .timeSensitive
        }
        return c
    }

    /// Replace the whole schedule with `planned`. Snoozes and stock alerts
    /// (other prefixes) are left alone.
    static func replaceSchedule(_ planned: [PlannedNotification], completion: @escaping () -> Void = {}) {
        center.getPendingNotificationRequests { pending in
            let old = pending.map(\.identifier).filter { $0.hasPrefix(NotificationAction.schedulePrefix) }
            center.removePendingNotificationRequests(withIdentifiers: old)
            let group = DispatchGroup()
            for n in planned {
                guard let fire = n.fireDate else { continue }
                let c = content(title: n.title, body: n.body, category: n.category, thread: n.threadId,
                                timeSensitive: n.timeSensitive, payload: n.payload)
                let request: UNNotificationRequest
                if n.id.hasPrefix(NotificationAction.schedulePrefix) {
                    let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fire)
                    request = UNNotificationRequest(identifier: n.id, content: c,
                                                    trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false))
                } else {
                    // stock alerts and anything else immediate: a short interval
                    let wait = max(1, fire.timeIntervalSinceNow)
                    request = UNNotificationRequest(identifier: n.id, content: c,
                                                    trigger: UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false))
                }
                group.enter()
                center.add(request) { _ in group.leave() }
            }
            group.notify(queue: .main) { completion() }
        }
    }

    /// "Remind in 30 min": the same reminder again, once.
    static func snooze(_ original: UNNotificationContent, payload: NotificationPayload) {
        let c = content(title: original.title, body: original.body, category: original.categoryIdentifier,
                        thread: original.threadIdentifier, timeSensitive: original.interruptionLevel == .timeSensitive,
                        payload: payload)
        let id = "\(NotificationAction.snoozePrefix)\(payload.date ?? "").\(payload.slot ?? "")"
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(NotificationAction.snoozeMinutes * 60), repeats: false)
        center.add(UNNotificationRequest(identifier: id, content: c, trigger: trigger))
    }

    /// After a tick from a widget, the Watch or a banner: drop the reminders
    /// and snoozes for slots that are now settled, and clear delivered ones.
    static func prune(with snapshot: Snapshot) {
        center.getPendingNotificationRequests { pending in
            let list = pending.compactMap { r -> (id: String, payload: NotificationPayload)? in
                guard let p = NotificationPayload.from(userInfo: r.content.userInfo) else { return nil }
                return (r.identifier, p)
            }
            let stale = NotificationAction.stale(pending: list, snapshot: snapshot)
            if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }
        }
        center.getDeliveredNotifications { delivered in
            let list = delivered.compactMap { n -> (id: String, payload: NotificationPayload)? in
                guard let p = NotificationPayload.from(userInfo: n.request.content.userInfo) else { return nil }
                return (n.request.identifier, p)
            }
            let stale = NotificationAction.stale(pending: list, snapshot: snapshot)
            if !stale.isEmpty { center.removeDeliveredNotifications(withIdentifiers: stale) }
        }
    }
}
