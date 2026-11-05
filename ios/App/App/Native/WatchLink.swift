import Foundation
import WatchConnectivity
import PepitoCore

/// The iPhone end of WatchConnectivity.
///
/// Out: the latest snapshot, as the application context (the Watch always gets
/// the newest one, even if it was asleep for the ones in between).
/// In: actions from the Watch (a dose tick, a skip, a finished sauna session)
/// as user info, which is queued and delivered even when neither app is
/// running. Each one goes through ActionSink like any other native tap.
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()
    private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }
    private var pending: Data?
    private(set) var lastSync: Date?

    func activate() {
        guard let s = session, s.delegate == nil || s.activationState != .activated else { return }
        s.delegate = self
        s.activate()
    }

    /// Send the snapshot (and remember it if the session is not ready yet).
    func push(snapshot data: Data) {
        guard let s = session else { return }
        guard s.activationState == .activated else { pending = data; activate(); return }
        guard s.isPaired, s.isWatchAppInstalled else { return }
        do {
            try s.updateApplicationContext(["snapshot": data, "sentAt": Date().timeIntervalSince1970])
            lastSync = Date()
        } catch {
            pending = data
        }
    }

    func status() -> [String: Any] {
        guard let s = session else { return ["supported": false] }
        var out: [String: Any] = [
            "supported": true,
            "activated": s.activationState == .activated,
            "paired": s.activationState == .activated && s.isPaired,
            "installed": s.activationState == .activated && s.isWatchAppInstalled,
            "reachable": s.isReachable
        ]
        if let d = lastSync { out["lastSync"] = PendingAction.iso(d) }
        return out
    }

    /// "Send test": a message the Watch answers straight away when it is
    /// reachable, otherwise a queued user info it will show when it next runs.
    func sendTest(_ done: @escaping (Bool, String) -> Void) {
        guard let s = session, s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else {
            done(false, "Apple Watch app not installed")
            return
        }
        if s.isReachable {
            s.sendMessage(["test": Date().timeIntervalSince1970], replyHandler: { _ in
                done(true, "Delivered")
            }, errorHandler: { error in
                done(false, error.localizedDescription)
            })
        } else {
            s.transferUserInfo(["test": Date().timeIntervalSince1970])
            done(true, "Queued until the Watch app opens")
        }
    }

    /// A command for the Watch app (stop the sauna it is recording): a message
    /// when it is reachable, otherwise queued user info for when it runs.
    func sendCommand(_ info: [String: Any]) {
        guard let s = session, s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
        if s.isReachable {
            s.sendMessage(info, replyHandler: nil) { _ in s.transferUserInfo(info) }
        } else {
            s.transferUserInfo(info)
        }
    }

    var isReachable: Bool { session?.isReachable ?? false }
    var isWatchAppInstalled: Bool { (session?.activationState == .activated) && (session?.isWatchAppInstalled ?? false) }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if activationState == .activated {
            if let p = pending { pending = nil; push(snapshot: p) }
            else if let data = SharedStore.shared().snapshotData() { push(snapshot: data) }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        receive(userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        receive(message)
        replyHandler(["ok": true])
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        if session.isWatchAppInstalled, let data = SharedStore.shared().snapshotData() { push(snapshot: data) }
        PepitoBridgePlugin.emit("watchChanged", status())
    }

    /// Actions arrive as JSON (one PendingAction, or a list).
    private func receive(_ info: [String: Any]) {
        if let live = LiveSauna.from(message: info) {
            DispatchQueue.main.async { SaunaActivityController.shared.live(live) }
            return
        }
        let decoder = JSONDecoder()
        var actions: [PendingAction] = []
        if let data = info["action"] as? Data, let a = try? decoder.decode(PendingAction.self, from: data) { actions.append(a) }
        if let data = info["actions"] as? Data, let list = try? decoder.decode([PendingAction].self, from: data) { actions += list }
        guard !actions.isEmpty else { return }
        lastSync = Date()
        ActionSink.record(actions)
    }
}
