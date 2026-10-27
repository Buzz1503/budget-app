import Foundation
import AVFoundation
import UserNotifications
import UIKit
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
        CAPPluginMethod(name: "testSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "soundsStartLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleSoundsCheck", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSoundsSchedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishedSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeSounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "screenTimeStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestScreenTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickLateUseApps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleLateUse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lateUse", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        DispatchQueue.main.async {
            SleepSoundsEngine.shared.prepareHomeKit()
            // a night left open by a closed app is closed at its last checkpoint
            SleepSoundsEngine.shared.recoverOpenSessions()
        }
    }

    // MARK: - sleep sounds

    @objc func soundsStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let e = SleepSoundsEngine.shared
            let d = UserDefaults.standard
            let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
            let bg = self.backgroundStartAvailable
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                DispatchQueue.main.async {
                    call.resolve([
                        "running": e.isRunning,
                        "startedAt": orNull(e.startedAt.map { $0.timeIntervalSince1970 * 1000 }),
                        "microphone": AVAudioApplication.shared.recordPermission == .granted ? "granted"
                            : AVAudioApplication.shared.recordPermission == .denied ? "denied" : "undetermined",
                        "backgroundAudio": modes.contains("audio"),
                        "notifications": allowed,
                        "lastStart": orNull((d.object(forKey: "pepito.sleepsounds.lastStart") as? Date).map { $0.timeIntervalSince1970 * 1000 }),
                        "lastStartedBy": orNull(d.string(forKey: "pepito.sleepsounds.lastStartedBy")),
                        "roomSensor": e.hasRoomSensor,
                        "gapOpen": e.hasOpenGap,
                        "lastCheckpoint": orNull(e.lastCheckpointMs),
                        "until": orNull(e.until.map { $0.timeIntervalSince1970 * 1000 }),
                        "iosVersion": UIDevice.current.systemVersion,
                        // iOS 18 and later: the scheduled start can begin listening with the phone locked
                        "backgroundStart": bg,
                        "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled
                    ])
                }
            }
        }
    }

    /// Starts in the foreground (the reliable path) and says exactly what happened.
    @objc func startSounds(_ call: CAPPluginCall) {
        let by = call.getString("by") ?? "app"
        let begin = {
            DispatchQueue.main.async {
                let r = SleepSoundsEngine.shared.startWithResult(by: by)
                let ok = r.result == SleepSoundsCore.StartResult.started.rawValue || r.result == SleepSoundsCore.StartResult.alreadyRunning.rawValue
                call.resolve(["running": ok, "result": r.result, "error": orNull(r.error)])
            }
        }
        if AVAudioApplication.shared.recordPermission == .granted { begin(); return }
        AVAudioApplication.requestRecordPermission { granted in
            if granted { begin() } else {
                DispatchQueue.main.async {
                    let e = SleepSoundsCore.LogEntry(at: Date().timeIntervalSince1970 * 1000, kind: "start", by: by, result: SleepSoundsCore.StartResult.noPermission.rawValue)
                    SleepSoundsEngine.shared.record(e)
                    call.resolve(["running": false, "result": e.result, "error": NSNull(), "microphone": "denied"])
                }
            }
        }
    }

    @objc func soundsStartLog(_ call: CAPPluginCall) {
        let rows: [[String: Any]] = SleepSoundsEngine.shared.startLog().map {
            ["at": $0.at, "kind": $0.kind, "by": $0.by, "result": $0.result, "error": orNull($0.error)]
        }
        call.resolve(["entries": rows])
    }

    /// Whether a tap on a "start it" notification is waiting for the web layer; read once.
    @objc func takePendingStart(_ call: CAPPluginCall) {
        let e = SleepSoundsEngine.shared
        let pending = e.pendingStart
        e.pendingStart = false
        call.resolve(["pending": pending])
    }

    /// The safety net: a notification on the next 7 nights, `offsetMin` after bedtime (or the schedule's
    /// start), unless listening has started by then. With the schedule it is "Tap to start Sleep sounds".
    @objc func scheduleSoundsCheck(_ call: CAPPluginCall) {
        let on = call.getBool("enabled") ?? false
        SleepSoundsNotices.scheduleChecks(bedtime: on ? call.getString("bedtime") : nil,
                                          offsetMin: call.getInt("offsetMin") ?? 10,
                                          scheduled: call.getBool("scheduled") ?? false)
        call.resolve()
    }

    /// Sleep sounds › Schedule: the nightly window the engine stops at (and the scheduled start uses).
    @objc func setSoundsSchedule(_ call: CAPPluginCall) {
        let s = SleepSoundsSchedule(on: call.getBool("on") ?? true, start: call.getString("start") ?? "21:00", stop: call.getString("stop") ?? "05:00")
        DispatchQueue.main.async {
            SleepSoundsEngine.shared.schedule = s
            call.resolve(["until": s.untilWords])
        }
    }

    private var backgroundStartAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    @objc func stopSounds(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            SleepSoundsEngine.shared.stop(reason: call.getString("reason") ?? "app")
            call.resolve(["running": false])
        }
    }

    /// Listen for one minute and say what was heard. Nothing is stored.
    @objc func testSounds(_ call: CAPPluginCall) {
        let run = {
            DispatchQueue.main.async { SleepSoundsEngine.shared.runTest { call.resolve($0) } }
        }
        if AVAudioApplication.shared.recordPermission == .granted { run(); return }
        AVAudioApplication.requestRecordPermission { granted in
            if granted { run() } else { call.resolve(["ran": false, "reason": "microphone"]) }
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
