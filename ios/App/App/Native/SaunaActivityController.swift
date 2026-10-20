import Foundation
import UIKit
import ActivityKit
import PepitoCore

/// Starts, keeps in step and ends the sauna Live Activity.
///
/// It follows the snapshot: a running session with no activity starts one, no
/// running session ends any that is left, and a session two hours past its
/// start is closed for it (queued as an automatic stop, saved as "needs
/// review"). iOS only lets an app start a Live Activity while it is in the
/// foreground or from a Live Activity intent (the widget Start, Siri, the Action
/// Button), so a session started on the Watch while the iPhone app is closed
/// gets its Live Activity the next time the app opens.
final class SaunaActivityController {
    static let shared = SaunaActivityController()

    private var enabled: Bool {
        NativeFeatures.liveActivities && ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func start(startedAt: Date, targetMin: Int, tempC: Int, rounds: Int = 1) {
        guard enabled, Activity<SaunaActivityAttributes>.activities.isEmpty else { return }
        let state = SaunaActivityAttributes.ContentState(
            startedAt: startedAt,
            targetAt: startedAt.addingTimeInterval(TimeInterval(targetMin * 60)),
            tempC: tempC, rounds: rounds)
        let content = ActivityContent(state: state, staleDate: startedAt.addingTimeInterval(SaunaLimits.autoEndAfter))
        _ = try? Activity.request(attributes: SaunaActivityAttributes(targetMin: targetMin), content: content, pushType: nil)
    }

    func endAll() {
        for activity in Activity<SaunaActivityAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    /// Bring the activity in line with the snapshot the web layer just wrote.
    func sync(with snap: Snapshot, now: Date = Date()) {
        guard let a = snap.sauna.active else { endAll(); return }
        if SaunaLimits.isOverdue(startedAtMs: a.startedAt, now: now) {
            ActionSink.record(PendingAction(type: .stopSauna, at: now, source: .liveActivity,
                                            payload: .init(stoppedAt: a.startedAt + SaunaLimits.autoEndAfter * 1000, autoEnded: true)))
            endAll()
            return
        }
        if Activity<SaunaActivityAttributes>.activities.isEmpty, UIApplication.shared.applicationState == .active {
            start(startedAt: a.startDate, targetMin: a.targetMin, tempC: a.tempC, rounds: a.rounds)
        }
    }
}
