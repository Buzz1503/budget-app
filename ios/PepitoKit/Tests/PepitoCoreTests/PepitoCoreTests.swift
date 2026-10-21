import XCTest
@testable import PepitoCore

/// The snapshot src/native/fixture.test.js generated with buildSnapshot.
func fixture() throws -> Snapshot {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "snapshot", withExtension: "json", subdirectory: "Fixtures"))
    return try Snapshot.decode(Data(contentsOf: url))
}

final class SnapshotDecodingTests: XCTestCase {

    func testDecodesWhatTheWebLayerWrites() throws {
        let s = try fixture()
        XCTAssertEqual(s.schema, Snapshot.supportedSchema)
        XCTAssertEqual(s.days.count, 7)
        XCTAssertEqual(s.days.first?.date, "2026-10-20")
        XCTAssertEqual(s.notifications?.remindOn, "watch")
        XCTAssertEqual(s.notifications?.nudgeDelayMin, 90)
        let reta = try XCTUnwrap(s.days[0].items.first { $0.refId == "reta" })
        XCTAssertEqual(reta.line, "Reta 3 mg, 30 units")
        XCTAssertEqual(reta.speech, "Log Retatrutide 3 milligrams")
        XCTAssertEqual(reta.slot, .pm)
        XCTAssertEqual(s.days[0].groups.first?.title, "Draw together: BPC-157 + TB-500")
        XCTAssertEqual(s.readiness?.score, 72)
        XCTAssertEqual(s.sauna.active?.targetMin, 20)
        XCTAssertEqual(s.watch.maxHR, 182)
    }

    func testRoundTrips() throws {
        let s = try fixture()
        XCTAssertEqual(try Snapshot.decode(s.encoded()), s)
    }
}

final class DoseBoardTests: XCTestCase {
    var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return c
    }()
    func at(_ h: Int, _ day: Int = 20) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h))!
    }

    func testAGroupIsOneRowThatLogsTheWholeGroup() throws {
        let s = try fixture()
        let rows = DoseBoard.rows(s, date: "2026-10-20", slot: .am)
        let group = try XCTUnwrap(rows.first { $0.isGroup })
        XCTAssertEqual(group.items.map(\.refId), ["bpc157", "tb500"])
        XCTAssertEqual(rows.filter { $0.isGroup }.count, 1)
        // Semax is nasal: its own row, already logged
        XCTAssertEqual(rows.first { $0.items.first?.refId == "semax" }?.status, .logged)
    }

    func testTheActiveSlotMovesOnWhenTheMorningIsDone() throws {
        var s = try fixture()
        XCTAssertEqual(DoseBoard.activeSlot(s, now: at(8), calendar: cal)?.slot, .am)
        for a in [PendingAction(type: .logDose, source: .widget, payload: .init(date: "2026-10-20", kind: "peptide", refIds: ["bpc157", "tb500"], group: true)),
                  PendingAction(type: .logDose, source: .widget, payload: .init(date: "2026-10-20", kind: "supplement", refId: "fish"))] {
            s.apply(a, now: at(8), calendar: cal)
        }
        let next = try XCTUnwrap(DoseBoard.activeSlot(s, now: at(8), calendar: cal))
        XCTAssertEqual(next.slot, .pm)
        XCTAssertEqual(next.date, "2026-10-20")
        XCTAssertEqual(s.next?.label, "Next: Reta 3 mg, 8 pm")
    }

    func testDueNowIsOnlyTheCurrentSlot() throws {
        let s = try fixture()
        let am = DoseBoard.dueNow(s, now: at(8), calendar: cal)
        XCTAssertEqual(am.rows.count, 2) // the group and the fish oil
        let pm = DoseBoard.dueNow(s, now: at(19), calendar: cal)
        XCTAssertEqual(pm.rows.map(\.title), ["Reta"])
    }

    func testClockLabelsMatchTheWeb() {
        XCTAssertEqual(DoseBoard.clockLabel("20:00"), "8 pm")
        XCTAssertEqual(DoseBoard.clockLabel("07:30"), "7:30 am")
        XCTAssertEqual(DoseBoard.clockLabel("00:00"), "12 am")
    }
}

final class SnapshotChangeTests: XCTestCase {
    func testATickSettlesOnlyWhatIsStillDue() throws {
        var s = try fixture()
        s.apply(PendingAction(type: .skipDose, source: .watch, payload: .init(date: "2026-10-20", refId: "semax")))
        XCTAssertEqual(s.days[0].items.first { $0.refId == "semax" }?.status, .logged)
        s.apply(PendingAction(type: .logDose, source: .watch, payload: .init(date: "2026-10-20", refId: "reta")))
        XCTAssertEqual(s.days[0].items.first { $0.refId == "reta" }?.status, .logged)
    }

    func testSaunaStartAndStopUpdateTheWeek() throws {
        var s = try fixture()
        s.apply(PendingAction(type: .stopSauna, source: .widget, payload: .init(stoppedAt: s.sauna.active!.startedAt + 25 * 60_000)))
        XCTAssertNil(s.sauna.active)
        XCTAssertEqual(s.sauna.week.sessions, 2)
        XCTAssertEqual(s.sauna.week.heatMin, 50)
        s.apply(PendingAction(type: .startSauna, source: .siri, payload: .init(startedAt: 1000)))
        XCTAssertEqual(s.sauna.active?.targetMin, s.sauna.usual.lengthMin)
        XCTAssertEqual(s.sauna.active?.source, "siri")
    }

    func testAPushRemovesTodaysOccurrence() throws {
        var s = try fixture()
        s.apply(PendingAction(type: .pushDose, source: .notification, payload: .init(date: "2026-10-20", refId: "reta")))
        XCTAssertNil(s.days[0].items.first { $0.refId == "reta" })
    }
}

final class SharedStoreTests: XCTestCase {
    func store() -> SharedStore {
        SharedStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
    }

    func testQueueAppendsOnceAndAcknowledgesById() throws {
        let st = store()
        let a = PendingAction(id: "a", type: .logDose, source: .widget, payload: .init(refId: "reta"))
        let b = PendingAction(id: "b", type: .skipDose, source: .widget, payload: .init(refId: "bpc157"))
        try st.append(a)
        try st.append(a)
        try st.append(b)
        XCTAssertEqual(st.pendingActions().map(\.id), ["a", "b"])
        try st.acknowledge(ids: ["a"])
        XCTAssertEqual(st.pendingActions().map(\.id), ["b"])
    }

    func testTheQueueIsJSONTheWebLayerReads() throws {
        let st = store()
        try st.append(PendingAction(id: "x", type: .logDose, at: Date(timeIntervalSince1970: 0), source: .watch,
                                    payload: .init(date: "2026-10-20", refIds: ["bpc157", "tb500"], group: true)))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: st.pendingActionsData()) as? [[String: Any]])
        XCTAssertEqual(json.first?["type"] as? String, "logDose")
        XCTAssertEqual(json.first?["at"] as? String, "1970-01-01T00:00:00.000Z")
        let payload = try XCTUnwrap(json.first?["payload"] as? [String: Any])
        XCTAssertEqual(payload["refIds"] as? [String], ["bpc157", "tb500"])
        XCTAssertEqual(payload["group"] as? Bool, true)
    }

    func testUpdateSnapshotChangesItUnderTheLock() throws {
        let st = store()
        try st.writeSnapshot(fixture())
        st.updateSnapshot { $0.apply(PendingAction(type: .logDose, source: .widget, payload: .init(date: "2026-10-20", refId: "reta"))) }
        XCTAssertEqual(st.readSnapshot()?.days[0].items.first { $0.refId == "reta" }?.status, .logged)
    }
}

final class HeartRateTests: XCTestCase {
    let floors = [0.5, 0.6, 0.7, 0.8, 0.9]

    func testZonesMatchTheWebRule() {
        // 100 bpm of 200 max is zone 1; each sample counts until the next, at most two minutes
        let s = [SaunaHeartRate.Sample(t: 0, bpm: 100), .init(t: 60, bpm: 130), .init(t: 120, bpm: 150), .init(t: 600, bpm: 150)]
        XCTAssertEqual(SaunaHeartRate.zoneMinutes(s, maxHR: 200, floors: floors), [1, 1, 2, 0, 0])
        XCTAssertEqual(SaunaHeartRate.zone(bpm: 185, maxHR: 200, floors: floors), 5)
        XCTAssertEqual(SaunaHeartRate.zone(bpm: 90, maxHR: 200, floors: floors), 0)
    }

    func testResamplesToFiveSeconds() {
        let s = [SaunaHeartRate.Sample(t: 0, bpm: 90), .init(t: 7, bpm: 95), .init(t: 20, bpm: 100)]
        let r = SaunaHeartRate.resample(s, from: 0, to: 20)
        XCTAssertEqual(r.map(\.t), [0, 5, 10, 15, 20])
        XCTAssertEqual(r.map(\.bpm), [90, 90, 95, 95, 100])
    }

    func testSparseIsUnderOneSampleAMinute() {
        let ten = (0..<10).map { SaunaHeartRate.Sample(t: Double($0) * 90, bpm: 100) }
        XCTAssertTrue(SaunaHeartRate.isSparse(ten, start: 0, end: 20 * 60))
        let many = (0..<30).map { SaunaHeartRate.Sample(t: Double($0) * 40, bpm: 100) }
        XCTAssertFalse(SaunaHeartRate.isSparse(many, start: 0, end: 20 * 60))
    }

    func testSummaryAndFiveMinuteMarks() {
        let s = [SaunaHeartRate.Sample(t: 0, bpm: 100), .init(t: 60, bpm: 140)]
        let sum = SaunaHeartRate.summary(s, start: 0, end: 60, maxHR: 200, floors: floors)
        XCTAssertEqual(sum.avg, 120)
        XCTAssertEqual(sum.peak, 140)
        XCTAssertEqual(SaunaHeartRate.fiveMinuteMarks(elapsedFrom: 290, to: 310), [5])
        XCTAssertEqual(SaunaHeartRate.fiveMinuteMarks(elapsedFrom: 310, to: 320), [])
    }
}

final class WatchRouteTests: XCTestCase {
    func testHomeFirstExceptARunningSession() {
        XCTAssertEqual(WatchRoute.launchPath(saunaRunning: true), [.sauna])
        XCTAssertEqual(WatchRoute.launchPath(saunaRunning: false), [])
    }

    func testComplicationLinksOpenTheirScreen() {
        XCTAssertEqual(WatchRoute.from(url: URL(string: "pepito://sauna")!), .sauna)
        XCTAssertEqual(WatchRoute.from(url: URL(string: "pepito://doses")!), .doses)
        XCTAssertEqual(WatchRoute.from(url: URL(string: "pepito://today")!), .doses)
        XCTAssertEqual(WatchRoute.from(url: URL(string: "pepito://readiness")!), .readiness)
        XCTAssertNil(WatchRoute.from(url: URL(string: "https://example.com/sauna")!))
    }

    func testReadinessOlderThanSixHoursShowsItsTime() throws {
        let s = try fixture()
        let asOf = ISO8601DateFormatter().date(from: "2026-10-20T06:30:00Z")!
        XCTAssertFalse(ReadinessAge.isStale(s, now: asOf.addingTimeInterval(5 * 3600)))
        XCTAssertTrue(ReadinessAge.isStale(s, now: asOf.addingTimeInterval(7 * 3600)))
    }
}

final class WatchHomeTests: XCTestCase {
    var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return c
    }()
    func at(_ h: Int, _ day: Int = 20) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h))! }

    func testDoseLineCountsRowsWithTheSlotTime() throws {
        let s = try fixture()
        // AM: the BPC-157 + TB-500 group and fish oil (Semax already logged)
        XCTAssertEqual(WatchHome.doses(s, now: at(8), calendar: cal), .init(text: "2 due · 7 am", done: false))
        XCTAssertEqual(WatchHome.doses(nil, now: at(8)), .init(text: "Open on iPhone", done: false))
    }

    func testAllLoggedNamesTheNextSlot() throws {
        var s = try fixture()
        for i in s.days[0].items.indices { s.days[0].items[i].status = .logged }
        XCTAssertEqual(WatchHome.doses(s, now: at(21), calendar: cal), .init(text: "All logged · 7 am", done: true))
        let screen = try XCTUnwrap(WatchHome.doseScreen(s, now: at(21), calendar: cal))
        XCTAssertTrue(screen.allLogged)
        XCTAssertEqual(screen.next, "7 am tomorrow")
    }

    func testDoseScreenHeaderAndLines() throws {
        let s = try fixture()
        let screen = try XCTUnwrap(WatchHome.doseScreen(s, now: at(8), calendar: cal))
        XCTAssertEqual(screen.slot, .am)
        XCTAssertEqual(screen.left, "2 of 3 left")
        let group = try XCTUnwrap(screen.rows.first { $0.isGroup })
        XCTAssertEqual(WatchHome.names(group), ["BPC-157", "TB-500"])
        XCTAssertEqual(WatchHome.doseLine(group), "50 units")
        let semax = try XCTUnwrap(screen.rows.first { $0.items.first?.refId == "semax" })
        XCTAssertEqual(WatchHome.doseLine(semax), "1 spray")
        let pm = try XCTUnwrap(WatchHome.doseScreen(s, now: at(15), calendar: cal))
        XCTAssertEqual(WatchHome.doseLine(pm.rows[0]), "3 mg · 30 units")
    }

    func testSaunaLine() throws {
        var s = try fixture()
        XCTAssertEqual(WatchHome.sauna(s).text, "Running")
        s.sauna.active = nil
        XCTAssertEqual(WatchHome.sauna(s), .init(text: "1 of 4 this week", done: false))
    }
}

final class WatchReminderTests: XCTestCase {
    struct Planned: Decodable {
        var id: String
        var title: String
        var body: String
        var fireLocal: String
        var category: String
        var threadId: String
        var timeSensitive: Bool
        var payload: NotificationPayload
    }

    func iphonePlan() throws -> [Planned] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "reminders", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode([Planned].self, from: Data(contentsOf: url))
    }

    func wall(_ d: Date, _ cal: Calendar) -> String {
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: d)
        return String(format: "%04d-%02d-%02dT%02d:%02d", c.year!, c.month!, c.day!, c.hour!, c.minute!)
    }

    /// The Watch, from the snapshot alone, plans exactly what the iPhone plans
    /// from the store: same ids, times, words, buttons and payloads.
    func testTheWatchPlansWhatTheIPhonePlans() throws {
        let cal = Calendar.current
        let s = try fixture()
        let now = try XCTUnwrap(WatchReminders.moment("2026-10-20", "08:00", calendar: cal))
        let watch = WatchReminders.plan(s, now: now, calendar: cal)
        let phone = try iphonePlan()
        XCTAssertEqual(watch.map(\.id), phone.map(\.id))
        for (w, p) in zip(watch, phone) {
            XCTAssertEqual(w.title, p.title, w.id)
            XCTAssertEqual(w.body, p.body, w.id)
            XCTAssertEqual(wall(w.fireDate, cal), p.fireLocal, w.id)
            XCTAssertEqual(w.category, p.category, w.id)
            XCTAssertEqual(w.threadId, p.threadId, w.id)
            XCTAssertEqual(w.timeSensitive, p.timeSensitive, w.id)
            XCTAssertEqual(w.payload, p.payload, w.id)
        }
    }

    func testNoDuplicatesAndEachSettingIsRespected() throws {
        var s = try fixture()
        let now = try XCTUnwrap(WatchReminders.moment("2026-10-20", "08:00"))
        let ids = WatchReminders.plan(s, now: now).map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count)
        XCTAssertTrue(WatchReminders.watchSchedules(s))
        s.notifications?.remindOn = "both"
        XCTAssertTrue(WatchReminders.watchSchedules(s))
        s.notifications?.remindOn = "iphone"
        XCTAssertFalse(WatchReminders.watchSchedules(s))
        s.notifications?.nudges = false
        XCTAssertTrue(WatchReminders.plan(s, now: now).allSatisfy { $0.id.contains(".dose.") })
        s.notifications?.doses = false
        XCTAssertTrue(WatchReminders.plan(s, now: now).isEmpty)
    }

    func testALoggedSlotHasNoReminderAndNoNudge() throws {
        var s = try fixture()
        for i in s.days[0].items.indices where s.days[0].items[i].slot == .am { s.days[0].items[i].status = .logged }
        let now = try XCTUnwrap(WatchReminders.moment("2026-10-20", "06:00"))
        let ids = WatchReminders.plan(s, now: now).map(\.id)
        XCTAssertFalse(ids.contains("pepito.sched.dose.2026-10-20.AM"))
        XCTAssertFalse(ids.contains("pepito.sched.nudge.2026-10-20.AM"))
        XCTAssertTrue(ids.contains("pepito.sched.dose.2026-10-20.PM"))
    }
}

final class RelevanceTests: XCTestCase {
    var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return c
    }()
    func at(_ h: Int, _ m: Int = 0) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: 20, hour: h, minute: m))! }

    func testNextDoseRisesHalfAnHourBeforeItsSlot() throws {
        var s = try fixture()
        for i in s.days[0].items.indices where s.days[0].items[i].slot == .am { s.days[0].items[i].status = .logged }
        XCTAssertEqual(WidgetRelevance.nextDose(s, at: at(19, 0), calendar: cal).score, 10)
        let r = WidgetRelevance.nextDose(s, at: at(19, 30), calendar: cal)
        XCTAssertEqual(r.score, 80)
        XCTAssertEqual(r.duration, 2 * 3600)  // until the nudge at 21:30
        XCTAssertEqual(WidgetRelevance.nextDose(nil, at: at(19, 30)), .low)
    }

    func testSaunaWhileRunningAndReadinessInTheMorning() throws {
        var s = try fixture()
        let start = s.sauna.active!.startDate
        XCTAssertEqual(WidgetRelevance.sauna(s, at: start.addingTimeInterval(60)).score, 100)
        s.sauna.active = nil
        XCTAssertEqual(WidgetRelevance.sauna(s, at: start).score, 5)
        XCTAssertEqual(WidgetRelevance.readiness(s, at: at(7), calendar: cal).score, 60)
        XCTAssertEqual(WidgetRelevance.readiness(s, at: at(7), calendar: cal).duration, 4 * 3600)
        XCTAssertEqual(WidgetRelevance.readiness(s, at: at(15), calendar: cal).score, 10)
    }

    func testTimelineMomentsIncludeTheLeadTime() throws {
        var s = try fixture()
        s.sauna.active = nil
        let m = WidgetRelevance.moments(s, from: at(6), calendar: cal)
        XCTAssertTrue(m.contains(at(6, 30)))   // 30 min before AM
        XCTAssertTrue(m.contains(at(19, 30)))  // 30 min before PM
        XCTAssertTrue(m.contains(at(11)))      // end of the morning
        XCTAssertEqual(m, m.sorted())
    }
}

final class LiveSaunaTests: XCTestCase {
    func testRoundTripsThroughAMessage() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let l = LiveSauna(heartRate: 128, rounds: 2, at: now)
        XCTAssertEqual(LiveSauna.from(message: l.message()), l)
        XCTAssertTrue(l.isFresh(now: now.addingTimeInterval(60)))
        XCTAssertFalse(l.isFresh(now: now.addingTimeInterval(120)))
    }

    func testZonePositionIsSmooth() {
        let f = [0.5, 0.6, 0.7, 0.8, 0.9]
        XCTAssertEqual(SaunaHeartRate.zonePosition(bpm: 100, maxHR: 200, floors: f), 1, accuracy: 0.001)
        XCTAssertEqual(SaunaHeartRate.zonePosition(bpm: 110, maxHR: 200, floors: f), 1.5, accuracy: 0.001)
        XCTAssertEqual(SaunaHeartRate.zonePosition(bpm: 190, maxHR: 200, floors: f), 5, accuracy: 0.001)
        XCTAssertEqual(SaunaHeartRate.zonePosition(bpm: 50, maxHR: 200, floors: f), 0.5, accuracy: 0.001)
    }
}

final class NotificationActionTests: XCTestCase {
    let payload = NotificationPayload(
        kind: "dose", date: "2026-10-20", slot: "AM",
        groups: [.init(id: "g", refIds: ["bpc157", "tb500"])],
        items: [.init(refId: "fish", kind: "supplement", canPush: false), .init(refId: "test-e", kind: "peptide", canPush: true)],
        pushable: ["test-e"])

    func testLogFromTheBannerLogsTheGroupAsOneAndEveryItem() {
        let a = NotificationAction.actions(for: NotificationAction.log, payload: payload)
        XCTAssertEqual(a.map(\.type), [.logDose, .logDose, .logDose])
        XCTAssertEqual(a[0].payload.refIds, ["bpc157", "tb500"])
        XCTAssertEqual(a[0].payload.group, true)
        XCTAssertEqual(a[1].payload.kind, "supplement")
        XCTAssertTrue(a.allSatisfy { $0.source == .notification })
        XCTAssertEqual(Set(a.map(\.id)).count, 3) // each has its own id
    }

    func testPushMovesOnlyWhatCanMoveAndSnoozeIsRecorded() {
        let push = NotificationAction.actions(for: NotificationAction.push, payload: payload)
        XCTAssertEqual(push.count, 1)
        XCTAssertEqual(push[0].payload.refIds, ["test-e"])
        XCTAssertEqual(NotificationAction.actions(for: NotificationAction.snooze, payload: payload).first?.type, .snoozeDose)
        XCTAssertTrue(NotificationAction.actions(for: NotificationAction.openStock, payload: payload).isEmpty)
    }

    func testTheWatchOffersLogAllSkipAndRemind() {
        let cats = Dictionary(uniqueKeysWithValues: NotificationAction.watchCategories.map { ($0.0, $0.1.map(\.1)) })
        XCTAssertEqual(cats["DOSE_LOG_PUSH"], ["Log all", "Skip", "Remind in 30 min"])
        XCTAssertEqual(cats["DOSE_TAKE"], ["Take all", "Skip", "Remind in 30 min"])
        XCTAssertEqual(cats["STOCK"], ["Open Stock"])
    }

    func testPayloadRoundTripsThroughUserInfo() {
        let info: [AnyHashable: Any] = [NotificationPayload.userInfoKey: payload.json()]
        XCTAssertEqual(NotificationPayload.from(userInfo: info), payload)
    }

    func testAReminderGoesStaleOnceItsSlotIsSettled() throws {
        var s = try fixture()
        let am = NotificationPayload(kind: "dose", date: "2026-10-20", slot: "AM")
        let pm = NotificationPayload(kind: "dose", date: "2026-10-20", slot: "PM")
        let pending = [(id: "pepito.sched.nudge.2026-10-20.AM", payload: am), (id: "pepito.sched.dose.2026-10-20.PM", payload: pm)]
        XCTAssertEqual(NotificationAction.stale(pending: pending, snapshot: s), [])
        s.apply(PendingAction(type: .logDose, source: .widget, payload: .init(date: "2026-10-20", refIds: ["bpc157", "tb500"], group: true)))
        s.apply(PendingAction(type: .logDose, source: .widget, payload: .init(date: "2026-10-20", kind: "supplement", refId: "fish")))
        XCTAssertEqual(NotificationAction.stale(pending: pending, snapshot: s), ["pepito.sched.nudge.2026-10-20.AM"])
    }
}

final class SaunaLimitTests: XCTestCase {
    func testASessionIsOverdueAfterTwoHours() {
        let start = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertFalse(SaunaLimits.isOverdue(startedAtMs: start.timeIntervalSince1970 * 1000, now: start.addingTimeInterval(7_199)))
        XCTAssertTrue(SaunaLimits.isOverdue(startedAtMs: start.timeIntervalSince1970 * 1000, now: start.addingTimeInterval(7_200)))
    }
}

final class WatchOutboxTests: XCTestCase {
    func testATickMadeOfflineSurvivesAnOlderSnapshot() throws {
        var box = WatchOutbox()
        let now = Date()
        box.add(PendingAction(type: .logDose, at: now, source: .watch, payload: .init(date: "2026-10-20", refId: "reta")))
        box.add(box.actions[0]) // the same action twice is kept once
        XCTAssertEqual(box.actions.count, 1)
        let shown = box.overlay(try fixture(), now: now)
        XCTAssertEqual(shown.days[0].items.first { $0.refId == "reta" }?.status, .logged)
        // a day later it is dropped, whatever the phone says
        _ = box.overlay(try fixture(), now: now.addingTimeInterval(25 * 3600))
        XCTAssertTrue(box.actions.isEmpty)
    }
}
