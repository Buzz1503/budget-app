import Foundation
import WatchConnectivity
import WidgetKit
import PepitoCore

/// The Watch's copy of the snapshot and its line to the iPhone.
///
/// The phone sends the snapshot as application context; it is kept in the
/// Watch's App Group so the complications read the same one. A tap here
/// (log, skip, a finished sauna) changes the snapshot at once and goes to the
/// phone as user info, which WatchConnectivity holds until the phone is
/// reachable, so the Watch works offline. The web layer on the phone applies
/// every action once, through the same logic as an in-app tap.
@MainActor
final class WatchStore: NSObject, ObservableObject {
    static let shared = WatchStore()

    @Published private(set) var snapshot: Snapshot?
    @Published var banner: String?
    @Published var launch: WatchLaunch = .readiness

    private let store = SharedStore.shared()
    private var outbox = WatchOutbox()
    private let outboxURL: URL

    override init() {
        outboxURL = SharedStore.shared().directory.appendingPathComponent("watch-outbox.json")
        super.init()
        if let d = try? Data(contentsOf: outboxURL), let box = try? JSONDecoder().decode(WatchOutbox.self, from: d) { outbox = box }
        snapshot = store.readSnapshot()
        launch = WatchLaunch.screen(for: snapshot, now: Date())
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
    }

    // MARK: - in

    func receive(snapshotData data: Data) {
        guard let incoming = try? Snapshot.decode(data) else { return }
        let shown = outbox.overlay(incoming)
        saveOutbox()
        try? store.writeSnapshot(shown)
        snapshot = shown
        // complications current straight away
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - out

    /// Apply locally, remember until the phone confirms, and send.
    func send(_ actions: [PendingAction]) {
        guard !actions.isEmpty else { return }
        var s = snapshot
        for a in actions {
            outbox.add(a)
            s?.apply(a)
        }
        saveOutbox()
        if let s { try? store.writeSnapshot(s); snapshot = s }
        WidgetCenter.shared.reloadAllTimelines()
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              let data = try? JSONEncoder().encode(actions) else { return }
        WCSession.default.transferUserInfo(["actions": data])
    }

    func send(_ action: PendingAction) { send([action]) }

    private func saveOutbox() {
        if let d = try? JSONEncoder().encode(outbox) { try? d.write(to: outboxURL, options: .atomic) }
    }

    // MARK: - doses

    var today: String { DoseBoard.dateString(Date()) }

    /// The current slot's rows (what the Today tab lists).
    func currentRows(now: Date = Date()) -> (slot: Snapshot.Slot, rows: [DoseBoard.Row]) {
        guard let s = snapshot else { return (.am, []) }
        let slot = DoseBoard.slot(at: now, splitHour: s.slotSplitHour)
        return (slot, DoseBoard.rows(s, date: DoseBoard.dateString(now), slot: slot))
    }

    func log(_ row: DoseBoard.Row) {
        switch row.content {
        case .group(let g, _): send(.log(group: g, source: .watch))
        case .single(let i): send(.log(i, date: row.date, source: .watch))
        }
    }

    func skip(_ row: DoseBoard.Row) {
        send(row.items.filter { $0.status == .due }.map { .skip($0, date: row.date, source: .watch) })
    }

    func logAllDue(now: Date = Date()) {
        guard let s = snapshot else { return }
        let due = DoseBoard.dueNow(s, now: now)
        send(due.rows.map { row -> PendingAction in
            switch row.content {
            case .group(let g, _): return .log(group: g, source: .watch)
            case .single(let i): return .log(i, date: row.date, source: .watch)
            }
        })
    }
}

extension WatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext
        if let data = context["snapshot"] as? Data {
            Task { @MainActor in self.receive(snapshotData: data) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let data = applicationContext["snapshot"] as? Data {
            Task { @MainActor in self.receive(snapshotData: data) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        replyHandler(["ok": true])
        Task { @MainActor in self.command(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.command(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in self.command(userInfo) }
    }

    /// "Send test" from the phone, and Stop for a session the phone stopped.
    @MainActor private func command(_ info: [String: Any]) {
        if info["test"] != nil { banner = "Test from your iPhone arrived." }
        if (info["command"] as? String) == "stopSauna" { SaunaWorkoutManager.shared.stop(fromPhone: true) }
    }
}
