import Foundation
import AVFoundation
import Capacitor
import PepitoCore

/**
 * PepitoSleep: the Sleep Lab's native parts for the web layer. Sleep sounds
 * (start, stop, status, the nights it finished), and late phone use from
 * Screen Time. Nothing here sends anything anywhere: finished nights are
 * collected by the web layer and kept on the phone.
 *
 * Registered from PepitoBridgeViewController.
 */
@objc(PepitoSleepPlugin)
public class PepitoSleepPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoSleepPlugin"
    public let jsName = "PepitoSleep"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "soundsStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishedSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "screenTimeStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestScreenTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickLateUseApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleLateUse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lateUse", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        DispatchQueue.main.async { SleepSoundsEngine.shared.prepareHomeKit() }
    }

    // MARK: - sleep sounds

    @objc func soundsStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let e = SleepSoundsEngine.shared
            let d = UserDefaults.standard
            call.resolve([
                "running": e.isRunning,
                "startedAt": orNull(e.startedAt.map { $0.timeIntervalSince1970 * 1000 }),
                "microphone": AVAudioApplication.shared.recordPermission == .granted ? "granted"
                    : AVAudioApplication.shared.recordPermission == .denied ? "denied" : "undetermined",
                "lastStart": orNull((d.object(forKey: "pepito.sleepsounds.lastStart") as? Date).map { $0.timeIntervalSince1970 * 1000 }),
                "lastStartedBy": orNull(d.string(forKey: "pepito.sleepsounds.lastStartedBy")),
                "roomSensor": e.hasRoomSensor
            ])
        }
    }

    @objc func startSounds(_ call: CAPPluginCall) {
        let begin = {
            DispatchQueue.main.async { call.resolve(["running": SleepSoundsEngine.shared.start(by: call.getString("by") ?? "app")]) }
        }
        if AVAudioApplication.shared.recordPermission == .granted { begin(); return }
        AVAudioApplication.requestRecordPermission { granted in
            if granted { begin() } else { call.resolve(["running": false, "microphone": "denied"]) }
        }
    }

    @objc func stopSounds(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            SleepSoundsEngine.shared.stop(reason: call.getString("reason") ?? "app")
            call.resolve(["running": false])
        }
    }

    @objc func finishedSounds(_ call: CAPPluginCall) {
        call.resolve(["sessions": SleepSoundsEngine.shared.finished()])
    }

    @objc func acknowledgeSounds(_ call: CAPPluginCall) {
        SleepSoundsEngine.shared.acknowledge(call.getArray("ids", String.self) ?? [])
        call.resolve()
    }

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
