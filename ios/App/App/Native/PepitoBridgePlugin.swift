import Foundation
import UIKit
import Capacitor
import WidgetKit
import UserNotifications
import PepitoCore

/**
 * PepitoBridge: the web layer's door to the native surfaces.
 *
 * The web layer owns every log and every number. It writes the snapshot here
 * whenever something relevant changes and when the app goes to the background,
 * and it drains the queue of actions that widgets, notifications, Siri and the
 * Watch appended while it was not looking. This plugin only moves bytes between
 * the two and tells the other surfaces to refresh.
 *
 * Registered from PepitoBridgeViewController, because it lives in the app
 * target next to the notification, Live Activity and Watch code it calls.
 */
@objc(PepitoBridgePlugin)
public class PepitoBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoBridgePlugin"
    public let jsName = "PepitoBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "features", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "watchStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendTestToWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometryType", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPrivacyCover", returnType: CAPPluginReturnPromise)
    ]

    private let store = SharedStore.shared()
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    override public func load() {
        PepitoBridgePlugin.current = self
        QueueSignal.observe { [weak self] in self?.notifyListeners("queueChanged", data: [:]) }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        WatchLink.shared.activate()
    }

    /// The live plugin, so the notification delegate and the Watch link can
    /// tell a running web layer that something arrived.
    static weak var current: PepitoBridgePlugin?

    static func emit(_ event: String, _ data: [String: Any] = [:]) {
        DispatchQueue.main.async { current?.notifyListeners(event, data: data) }
    }

    @objc private func didBecomeActive() {
        PrivacyCover.hide()
        notifyListeners("appActive", data: [:])
    }

    /// Ask for a few seconds so the web layer can write a fresh snapshot on its way out.
    @objc private func willResignActive() {
        if backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "pepito-snapshot") { [weak self] in
                self?.endBackgroundTask()
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.endBackgroundTask() }
        }
        PrivacyCover.show()
        notifyListeners("appBackground", data: [:])
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - snapshot

    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("No snapshot")
            return
        }
        do {
            let snap = try Snapshot.decode(data) // never write something the surfaces cannot read
            try store.writeSnapshot(data: data)
            WidgetCenter.shared.reloadAllTimelines()
            WatchLink.shared.push(snapshot: data)
            SaunaActivityController.shared.sync(with: snap)
            call.resolve(["ok": true])
        } catch {
            call.reject("Snapshot not written: \(error.localizedDescription)")
        }
        if UIApplication.shared.applicationState != .active { endBackgroundTask() }
    }

    // MARK: - queue

    @objc func readQueue(_ call: CAPPluginCall) {
        let data = store.pendingActionsData()
        let list = (try? JSONSerialization.jsonObject(with: data)) as? [Any] ?? []
        call.resolve(["actions": list])
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        do {
            try store.acknowledge(ids: ids)
            call.resolve()
        } catch {
            call.reject("Queue not updated: \(error.localizedDescription)")
        }
    }

    @objc func features(_ call: CAPPluginCall) {
        call.resolve([
            "appGroup": NativeFeatures.appGroup,
            "timeSensitive": NativeFeatures.timeSensitive,
            "watchHealthKit": NativeFeatures.watchHealthKit,
            "liveActivities": NativeFeatures.liveActivities
        ])
    }

    // MARK: - notifications

    private static func words(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }

    @objc func notificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            call.resolve([
                "display": PepitoBridgePlugin.words(s.authorizationStatus),
                "timeSensitive": s.timeSensitiveSetting == .enabled
            ])
        }
    }

    /// Asked the first time the Notifications page opens or a sauna timer starts, never at launch.
    @objc func requestNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["display": granted ? "granted" : "denied"])
        }
    }

    /// The rolling seven-day schedule from src/native/notifySchedule.js, plus any stock alerts.
    @objc func scheduleNotifications(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8),
              let planned = try? JSONDecoder().decode([PlannedNotification].self, from: data) else {
            call.reject("No schedule")
            return
        }
        PepitoNotifications.registerCategories()
        PepitoNotifications.replaceSchedule(planned) { call.resolve(["scheduled": planned.count]) }
    }

    /// The screen a notification tap asked for, once.
    @objc func takeRoute(_ call: CAPPluginCall) {
        if let r = RouteBox.take() { call.resolve(["route": r]) } else { call.resolve([:]) }
    }

    // MARK: - Watch

    @objc func watchStatus(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.status())
    }

    @objc func sendTestToWatch(_ call: CAPPluginCall) {
        WatchLink.shared.sendTest { ok, detail in
            call.resolve(["delivered": ok, "detail": detail])
        }
    }
}
