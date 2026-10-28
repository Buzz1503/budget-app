import Foundation
import CoreMotion
import PepitoCore

/// Starting the overnight movement recording, shared by the Watch app and its
/// complications. The app starts it on its first background refresh after
/// 6 pm, on launch and on every new snapshot; a complication refreshing after
/// 6 pm is the backup, so the recording never needs starting by hand. The
/// last start is kept in the App Group, so the two never start it twice.
enum RestlessStart {
    static let lastStartKey = "pepito.restless.lastStart"

    static var defaults: UserDefaults {
        (NativeFeatures.appGroup ? UserDefaults(suiteName: SharedStore.appGroup) : nil) ?? .standard
    }

    /// Start tonight's 12 hours if due. A complication only starts it once
    /// motion access has been given in the app; the app may ask for it.
    @discardableResult
    static func startIfDue(enabled: Bool, fromExtension: Bool, now: Date = Date()) -> Bool {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return false }
        let status = CMSensorRecorder.authorizationStatus()
        if status == .denied || status == .restricted { return false }
        if fromExtension && status != .authorized { return false }
        let last = defaults.object(forKey: lastStartKey) as? Date
        guard RestlessRecording.shouldStart(now: now, lastStart: last, enabled: enabled) else { return false }
        CMSensorRecorder().recordAccelerometer(forDuration: RestlessRecording.durationH * 3600)
        defaults.set(now, forKey: lastStartKey)
        return true
    }

    /// Start sleep: make sure movement is recorded for the next 10 hours, starting a new
    /// recording when tonight's would end too soon. Never from an extension without access.
    @discardableResult
    static func ensureCovers(now: Date = Date()) -> Bool {
        guard CMSensorRecorder.isAccelerometerRecordingAvailable() else { return false }
        let status = CMSensorRecorder.authorizationStatus()
        if status == .denied || status == .restricted { return false }
        let last = defaults.object(forKey: lastStartKey) as? Date
        guard SleepMode.recordingNeeded(now: now, lastStart: last) else { return false }
        CMSensorRecorder().recordAccelerometer(forDuration: RestlessRecording.durationH * 3600)
        defaults.set(now, forKey: lastStartKey)
        return true
    }
}
