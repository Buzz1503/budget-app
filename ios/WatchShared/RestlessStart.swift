import Foundation
import CoreMotion
import PepitoCore

/// Asking for the overnight movement recording, shared by the Watch app and its
/// complications. CMSensorRecorder records only for the window requested, so a
/// fresh 12 hours is asked for every time the Watch app runs, on every snapshot,
/// when Sleep sounds starts or its 9 pm schedule fires on the iPhone, and on
/// Start sleep (`RestlessRecording.Trigger`). The last request is kept in the
/// App Group with what asked for it, so the app and complications never ask
/// twice within 10 minutes, and the report to the iPhone can say when it was.
enum RestlessStart {
    static let lastStartKey = "pepito.restless.lastStart"
    static let lastTriggerKey = "pepito.restless.lastTrigger"

    static var defaults: UserDefaults {
        (NativeFeatures.appGroup ? UserDefaults(suiteName: SharedStore.appGroup) : nil) ?? .standard
    }

    static var lastStart: Date? { defaults.object(forKey: lastStartKey) as? Date }
    static var lastTrigger: RestlessRecording.Trigger? { defaults.string(forKey: lastTriggerKey).flatMap(RestlessRecording.Trigger.init(rawValue:)) }

    /// Ask for a fresh 12 hours from now. A complication only asks once motion access
    /// has been given in the app; the app may ask for it.
    @discardableResult
    static func request(_ trigger: RestlessRecording.Trigger, enabled: Bool, fromExtension: Bool = false, now: Date = Date()) -> Bool {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return false }
        let status = CMSensorRecorder.authorizationStatus()
        if status == .denied || status == .restricted { return false }
        if fromExtension && status != .authorized { return false }
        guard RestlessRecording.shouldRequest(trigger: trigger, now: now, lastStart: lastStart, enabled: enabled) else { return false }
        CMSensorRecorder().recordAccelerometer(forDuration: RestlessRecording.durationH * 3600)
        defaults.set(now, forKey: lastStartKey)
        defaults.set(trigger.rawValue, forKey: lastTriggerKey)
        return true
    }

    /// The complications' backup start (kept for their timelines).
    @discardableResult
    static func startIfDue(enabled: Bool, fromExtension: Bool, now: Date = Date()) -> Bool {
        request(.complication, enabled: enabled, fromExtension: fromExtension, now: now)
    }

    /// Start sleep: always a fresh window from now.
    @discardableResult
    static func ensureCovers(now: Date = Date()) -> Bool {
        request(.startSleep, enabled: true, now: now)
    }
}
