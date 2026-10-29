import Foundation
import WatchConnectivity
import WidgetKit
import UserNotifications
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
    /// The navigation stack under Home. Empty is Home.
    @Published var path: [WatchRoute] = []
    /// When each row was ticked here, for "Logged 7:42 am".
    @Published private(set) var loggedAt: [String: Date] = [:]
    /// Something ticked here has not reached the iPhone yet.
    @Published private(set) var willSync = false
    /// Ticks that left a vial about empty, each waiting for its answer.
    @Published private(set) var vialQuestions: [VialQuestion] = []
    /// Sleep mode: tonight's lights out and the morning's get-up, kept in the App Group for the complication.
    @Published private(set) var sleepNight: SleepMode.Night?

    struct VialQuestion: Identifiable, Equatable {
        let id: String
        let name: String
    }

    private let store = SharedStore.shared()
    private var outbox = WatchOutbox()
    private let outboxURL: URL

    override init() {
        outboxURL = SharedStore.shared().directory.appendingPathComponent("watch-outbox.json")
        super.init()
        if let d = try? Data(contentsOf: outboxURL), let box = try? JSONDecoder().decode(WatchOutbox.self, from: d) { outbox = box }
        snapshot = store.readSnapshot()
        sleepNight = SleepMode.load(RestlessStart.defaults)
    }

    /// Open a screen from Home, a complication or the Smart Stack.
    func open(_ route: WatchRoute) { path = [route] }

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
        // tonight's prompt time is kept for the battery check before a newer snapshot moves it on
        WatchSelfCheck.remember(snapshot)
        snapshot = shown
        // "Took Dex" takes its name from the snapshot
        WatchAppDelegate.registerCategories()
        // complications current straight away, and the Watch's own reminders rebuilt
        WidgetCenter.shared.reloadAllTimelines()
        WatchReminderScheduler.reschedule(shown)
        refreshSyncState()
        // a fresh movement recording window on every snapshot
        RestlessRecorder.shared.tick(.snapshot)
    }

    func refreshSyncState() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { willSync = !outbox.actions.isEmpty; return }
        willSync = !WCSession.default.outstandingUserInfoTransfers.isEmpty
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
        if let s { try? store.writeSnapshot(s); snapshot = s; WatchReminderScheduler.reschedule(s) }
        WidgetCenter.shared.reloadAllTimelines()
        willSync = true
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              let data = try? JSONEncoder().encode(actions) else { return }
        WCSession.default.transferUserInfo(["actions": data])
    }

    /// Live heart rate for the iPhone's Live Activity: a message or nothing.
    func sendLive(_ live: LiveSauna) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(live.message(), replyHandler: nil, errorHandler: nil)
    }

    func send(_ action: PendingAction) { send([action]) }

    private func saveOutbox() {
        if let d = try? JSONEncoder().encode(outbox) { try? d.write(to: outboxURL, options: .atomic) }
    }

    // MARK: - doses

    var today: String { DoseBoard.dateString(Date()) }

    func log(_ row: DoseBoard.Row) {
        loggedAt[row.id] = Date()
        switch row.content {
        case .group(let g, _): send(.log(group: g, source: .watch))
        case .single(let i): send(.log(i, date: row.date, source: .watch))
        }
        askAboutVials(row.items)
    }

    // MARK: - vials

    /// After a tick: the question for each item whose vial it leaves about empty.
    private func askAboutVials(_ items: [Snapshot.Item]) {
        for i in items where i.kind == .peptide && i.vialAsk == true && !vialQuestions.contains(where: { $0.id == i.refId }) {
            vialQuestions.append(VialQuestion(id: i.refId, name: i.name))
        }
    }

    /// Yes starts a new vial, Still some left keeps this one. Either way it goes to the iPhone as a queued action.
    func answerVial(_ q: VialQuestion, yes: Bool) {
        vialQuestions.removeAll { $0.id == q.id }
        send(PendingAction(type: .vialChange, source: .watch,
                           payload: .init(kind: "change", refId: q.id, answer: yes ? "yes" : "still")))
    }

    /// Swiped away without answering: the iPhone asks instead.
    func dismissVial(_ q: VialQuestion) { vialQuestions.removeAll { $0.id == q.id } }

    func skip(_ row: DoseBoard.Row) {
        send(row.items.filter { $0.status == .due }.map { .skip($0, date: row.date, source: .watch) })
    }

    /// Log every row given (the Doses screen's Log all), each group as one draw.
    func logAll(_ rows: [DoseBoard.Row], now: Date = Date()) {
        let due = rows.filter { $0.status == .due }
        for r in due { loggedAt[r.id] = now }
        send(due.map { row -> PendingAction in
            switch row.content {
            case .group(let g, _): return .log(group: g, source: .watch)
            case .single(let i): return .log(i, date: row.date, source: .watch)
            }
        })
        askAboutVials(due.flatMap(\.items))
    }

    func logAllDue(now: Date = Date()) {
        guard let s = snapshot else { return }
        let due = DoseBoard.dueNow(s, now: now)
        for r in due.rows { loggedAt[r.id] = now }
        send(due.rows.map { row -> PendingAction in
            switch row.content {
            case .group(let g, _): return .log(group: g, source: .watch)
            case .single(let i): return .log(i, date: row.date, source: .watch)
            }
        })
        askAboutVials(due.rows.flatMap(\.items))
    }
}

// MARK: - sleep mode

extension WatchStore {
    /// Start sleep: lights out now, movement covered for 10 hours, Sleep sounds asked for on the iPhone, the night screen.
    func startSleep(now: Date = Date()) {
        let night = SleepMode.Night(lightsOut: now)
        SleepMode.save(night, to: RestlessStart.defaults)
        sleepNight = night
        RestlessStart.ensureCovers(now: now)
        sendSleepCommand(.start, at: now)
        send(SleepMode.action(.start, at: now))
        path = [.sleep]
    }

    /// "I'm up": the get-up time, Sleep sounds stopped on the iPhone, then the morning screen.
    func wakeUp(now: Date = Date()) {
        var night = sleepNight ?? SleepMode.Night(lightsOut: now)
        night.upAt = now
        SleepMode.save(night, to: RestlessStart.defaults)
        sleepNight = night
        sendSleepCommand(.up, at: now)
        send(SleepMode.action(.up, at: now))
    }

    /// A message when the iPhone is reachable (it wakes the iPhone app in the background), queued otherwise.
    private func sendSleepCommand(_ command: SleepMode.Command, at: Date) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        let info = SleepMode.message(command, at: at)
        let s = WCSession.default
        if s.isReachable {
            s.sendMessage(info, replyHandler: nil) { _ in s.transferUserInfo(info) }
        } else {
            s.transferUserInfo(info)
        }
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

    nonisolated func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        Task { @MainActor in self.refreshSyncState() }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in self.command(userInfo) }
    }

    /// "Send test" from the phone, Stop for a session the phone stopped, and a fresh
    /// movement recording window when Sleep sounds starts or its schedule fires.
    @MainActor private func command(_ info: [String: Any]) {
        if info["test"] != nil { banner = "Test from your iPhone arrived." }
        if let trigger = RestlessRecording.trigger(from: info) { RestlessRecorder.shared.tick(trigger) }
        if (info["command"] as? String) == "stopSauna" { SaunaWorkoutManager.shared.stop(fromPhone: true) }
    }
}

/// The Watch's own dose reminders (More › Notifications › Remind me on: Watch
/// or Both), rebuilt from every new snapshot and after every tick here. Same
/// ids as the iPhone's, so with Both the wrist shows one of each.
enum WatchReminderScheduler {
    static func reschedule(_ snap: Snapshot, now: Date = Date()) {
        let center = UNUserNotificationCenter.current()
        let wanted = WatchReminders.watchSchedules(snap) ? WatchReminders.plan(snap, now: now) : []
        center.getNotificationSettings { settings in
            if settings.authorizationStatus == .notDetermined, !wanted.isEmpty {
                // asked the first time the Watch has a reminder of its own to give
                center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                    if granted { replace(wanted, timeSensitive: true) }
                }
                return
            }
            replace(wanted, timeSensitive: settings.timeSensitiveSetting == .enabled)
        }
    }

    private static func replace(_ list: [WatchReminders.Reminder], timeSensitive allowed: Bool) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let old = pending.map(\.identifier).filter { $0.hasPrefix(NotificationAction.schedulePrefix) }
            center.removePendingNotificationRequests(withIdentifiers: old)
            for r in list {
                let c = UNMutableNotificationContent()
                c.title = r.title
                c.body = r.body
                c.sound = .default
                c.categoryIdentifier = r.category
                c.threadIdentifier = r.threadId
                c.userInfo = [NotificationPayload.userInfoKey: r.payload.json()]
                if r.timeSensitive && allowed && NativeFeatures.timeSensitive { c.interruptionLevel = .timeSensitive }
                let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: r.fireDate)
                center.add(UNNotificationRequest(identifier: r.id, content: c,
                                                 trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
            }
        }
    }
}
