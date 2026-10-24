import Foundation

/// Features that depend on what the Apple account signing the app can use.
///
/// Each target's Info.plist carries a `PepitoFeatures` dictionary written by
/// ios/scripts/native_targets.rb from ios/native-features.json. A feature that
/// is switched off there is also left out of the target's entitlements, so a
/// free personal team can still sign and install everything else.
public enum NativeFeatures {
    private static var plist: [String: Any] {
        (Bundle.main.object(forInfoDictionaryKey: "PepitoFeatures") as? [String: Any]) ?? [:]
    }
    private static func flag(_ key: String) -> Bool { (plist[key] as? Bool) ?? true }

    /// App Group shared container (widgets, intents and the app see one snapshot).
    public static var appGroup: Bool { flag("appGroup") }
    /// Time Sensitive notifications that get through Focus.
    public static var timeSensitive: Bool { flag("timeSensitive") }
    /// HealthKit workouts and heart rate on the Watch.
    public static var watchHealthKit: Bool { flag("watchHealthKit") }
    /// The sauna Live Activity.
    public static var liveActivities: Bool { flag("liveActivities") }
    /// HomeKit, for a bedroom temperature sensor during Sleep sounds.
    public static var homeKit: Bool { flag("homeKit") }
    /// Screen Time (Family Controls), for late phone use.
    public static var screenTime: Bool { flag("screenTime") }
}
