import Foundation
import UIKit
import Capacitor
import PepitoCore

/**
 * PepitoSleep: the Sleep Lab's native part for the web layer: late phone use
 * from Screen Time. Nothing here sends anything anywhere. (Sleep sounds was
 * removed: all sleep data now comes from Apple Health.)
 *
 * Registered from PepitoBridgeViewController.
 */
@objc(PepitoSleepPlugin)
public class PepitoSleepPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoSleepPlugin"
    public let jsName = "PepitoSleep"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "screenTimeStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestScreenTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickLateUseApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleLateUse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lateUse", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - late phone use (Screen Time)

    @objc func screenTimeStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(LateUse.status()) }
    }

    @objc func requestScreenTime(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(await LateUse.requestAuthorization()) }
    }

    @objc func pickLateUseApps(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.resolve(["picked": false]); return }
            LateUse.presentPicker(from: vc) { picked in call.resolve(["picked": picked]) }
        }
    }

    /// Watch phone use each night from planned bedtime to wake ('HH:MM' each).
    @objc func scheduleLateUse(_ call: CAPPluginCall) {
        let bed = call.getString("bedtime") ?? "22:30"
        let wake = call.getString("wake") ?? "07:00"
        DispatchQueue.main.async { call.resolve(["scheduled": LateUse.schedule(bedtime: bed, wake: wake)]) }
    }

    /// Minutes of use the monitor saw, per night, from the App Group.
    @objc func lateUse(_ call: CAPPluginCall) {
        call.resolve(["nights": LateUse.readNights()])
    }
}

/// An optional as a plugin result value: the value, or null.
func orNull<T>(_ v: T?) -> Any { v.map { $0 as Any } ?? NSNull() }
