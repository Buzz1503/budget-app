import Foundation
import DeviceActivity
import PepitoCore

/// Screen Time's monitor: each night from planned bedtime to wake, writes the
/// highest usage threshold reached (minutes of the chosen apps) to the App
/// Group, filed under the evening's date. Nothing else leaves Screen Time.
class LateUseMonitor: DeviceActivityMonitor {
    private var url: URL { SharedStore.shared().directory.appendingPathComponent(LateUseLog.file) }

    private func update(_ minutes: Int) {
        let current = (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode([String: Int].self, from: $0) } ?? [:]
        let next = LateUseLog.record(current, night: LateUseLog.night(of: Date()), minutes: minutes)
        if let d = try? JSONEncoder().encode(next) { try? d.write(to: url, options: .atomic) }
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        update(0)
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        if let m = LateUseLog.minutes(event: event.rawValue) { update(m) }
    }
}
