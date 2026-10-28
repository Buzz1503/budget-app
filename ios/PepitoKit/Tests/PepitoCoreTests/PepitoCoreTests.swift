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

    func testCoolDownDropMatchesTheApp() {
        // the same case as analytics.test.ts: 130 at the exit, falling 1 bpm every 10 s for 5 minutes
        let exit = 1_792_000_000.0
        let samples = (0...60).map { i in SaunaHeartRate.Sample(t: exit + Double(i) * 5, bpm: 130 - min(Double(i) * 5, 300) / 10) }
        XCTAssertEqual(SaunaHeartRate.coolDownDrop(samples, exit: exit), .init(exitHR: 130, drop2: 12, drop5: 30))
        XCTAssertEqual(SaunaHeartRate.coolDownDrop(Array(samples.prefix(20)), exit: exit), .init(exitHR: 130, drop2: nil, drop5: nil))
        XCTAssertNil(SaunaHeartRate.coolDownDrop([], exit: exit))
    }

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
        // the sleep prompts have their own switches (More › Health › Sleep)
        let notDose = { (r: WatchReminders.Reminder) in r.id.contains(".restart.") || r.category == "EVENING" || r.category == "MORNING" }
        let doseOnly = WatchReminders.plan(s, now: now).filter { !notDose($0) }
        XCTAssertTrue(doseOnly.allSatisfy { $0.id.contains(".dose.") })
        s.notifications?.doses = false
        XCTAssertTrue(WatchReminders.plan(s, now: now).filter { !notDose($0) }.isEmpty)
    }

    func testARestingCompoundIsNotDueAndComesBackOnItsFirstDay() throws {
        let s = try fixture()
        let rest = DoseBoard.rows(s, date: "2026-10-20", slot: .am).flatMap(\.items).map(\.name)
        let back = DoseBoard.rows(s, date: "2026-10-21", slot: .am).flatMap(\.items).map(\.name)
        XCTAssertFalse(rest.contains("Epithalon"))
        XCTAssertTrue(back.contains("Epithalon"))
        // at midnight the Today slot rolls onto the new day without the phone having written anything
        let cal = Calendar.current
        let lateOnTheRest = try XCTUnwrap(WatchReminders.moment("2026-10-20", "23:30", calendar: cal))
        let justAfter = try XCTUnwrap(WatchReminders.moment("2026-10-21", "00:10", calendar: cal))
        XCTAssertNil(DoseBoard.next(s, now: lateOnTheRest, calendar: cal).flatMap { $0.line.contains("Epithalon") ? $0 : nil })
        let am = DoseBoard.rows(s, date: DoseBoard.dateString(justAfter, calendar: cal), slot: .am).filter { $0.status == .due }
        XCTAssertTrue(am.contains { $0.items.contains { $0.name == "Epithalon" } })
    }

    func testTheEveningBeforeARestartTheWatchSaysSo() throws {
        var s = try fixture()
        let cal = Calendar.current
        let now = try XCTUnwrap(WatchReminders.moment("2026-10-20", "08:00", calendar: cal))
        let r = try XCTUnwrap(WatchReminders.plan(s, now: now, calendar: cal).first { $0.id == "pepito.sched.restart.2026-10-21" })
        XCTAssertEqual(r.body, "Epithalon restarts tomorrow")
        XCTAssertEqual(r.fireDate, WatchReminders.moment("2026-10-20", "19:00", calendar: cal))
        XCTAssertEqual(WatchReminders.restartWords(["Epithalon", "KPV"]), "Epithalon and KPV restart tomorrow")
        XCTAssertEqual(WatchReminders.restartWords(["A", "B", "C"]), "A, B and C restart tomorrow")
        // after the evening has passed it is not offered again
        let late = try XCTUnwrap(WatchReminders.moment("2026-10-20", "21:00", calendar: cal))
        XCTAssertFalse(WatchReminders.plan(s, now: late, calendar: cal).contains { $0.id.contains(".restart.") })
        // the setting turns it off, and "iPhone only" leaves the Watch with nothing to schedule
        s.notifications?.restarts = false
        XCTAssertFalse(WatchReminders.plan(s, now: now, calendar: cal).contains { $0.id.contains(".restart.") })
        s.notifications?.restarts = true
        s.notifications?.remindOn = "iphone"
        XCTAssertFalse(WatchReminders.watchSchedules(s))
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
        XCTAssertEqual(SurfaceRelevance.nextDose(s, at: at(19, 0), calendar: cal).score, 10)
        let r = SurfaceRelevance.nextDose(s, at: at(19, 30), calendar: cal)
        XCTAssertEqual(r.score, 80)
        XCTAssertEqual(r.duration, 2 * 3600)  // until the nudge at 21:30
        XCTAssertEqual(SurfaceRelevance.nextDose(nil, at: at(19, 30)), .low)
    }

    func testSaunaWhileRunningAndReadinessInTheMorning() throws {
        var s = try fixture()
        let start = s.sauna.active!.startDate
        XCTAssertEqual(SurfaceRelevance.sauna(s, at: start.addingTimeInterval(60)).score, 100)
        s.sauna.active = nil
        XCTAssertEqual(SurfaceRelevance.sauna(s, at: start).score, 5)
        XCTAssertEqual(SurfaceRelevance.readiness(s, at: at(7), calendar: cal).score, 60)
        XCTAssertEqual(SurfaceRelevance.readiness(s, at: at(7), calendar: cal).duration, 4 * 3600)
        XCTAssertEqual(SurfaceRelevance.readiness(s, at: at(15), calendar: cal).score, 10)
    }

    func testTimelineMomentsIncludeTheLeadTime() throws {
        var s = try fixture()
        s.sauna.active = nil
        let m = SurfaceRelevance.moments(s, from: at(6), calendar: cal)
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

/// Stock tracking: the question after a log, the order-by notice and the weekly
/// count, from a notification, the Watch or the snapshot.
final class StockNativeTests: XCTestCase {
    let vial = NotificationPayload(kind: "vial", route: "supplies", refId: "reta", vialKind: "change")

    func testTheQuestionAfterALogHasYesAndStillSomeLeft() {
        let cats = Dictionary(uniqueKeysWithValues: NotificationAction.categories.map { ($0.0, $0.1.map(\.1)) })
        XCTAssertEqual(cats["VIAL_CHANGE"], ["Yes", "Still some left"])
        XCTAssertEqual(cats["VIAL_EXPIRED"], ["Yes", "Not yet"])
        XCTAssertEqual(cats["ORDER"], ["Remind me in 3 days", "Open Stock"])
        XCTAssertEqual(cats["COUNT"], ["Count now"])
        // the same on the wrist
        let watch = Dictionary(uniqueKeysWithValues: NotificationAction.watchCategories.map { ($0.0, $0.1.map(\.1)) })
        XCTAssertEqual(watch["VIAL_CHANGE"], ["Yes", "Still some left"])
    }

    func testEachAnswerIsAQueuedAction() throws {
        let yes = try XCTUnwrap(NotificationAction.actions(for: NotificationAction.vialYes, payload: vial).first)
        XCTAssertEqual(yes.type, .vialChange)
        XCTAssertEqual(yes.payload.refId, "reta")
        XCTAssertEqual(yes.payload.answer, "yes")
        XCTAssertEqual(yes.payload.kind, "change")
        XCTAssertEqual(yes.source, .notification)
        XCTAssertEqual(NotificationAction.actions(for: NotificationAction.vialStill, payload: vial).first?.payload.answer, "still")
        var expired = vial; expired.vialKind = "expired"
        let notYet = try XCTUnwrap(NotificationAction.actions(for: NotificationAction.vialNotYet, payload: expired).first)
        XCTAssertEqual(notYet.payload.answer, "notyet")
        XCTAssertEqual(notYet.payload.kind, "expired")
    }

    func testRemindMeInThreeDaysIsAnAction() throws {
        let order = NotificationPayload(kind: "order", route: "supplies", refId: "reta")
        let a = try XCTUnwrap(NotificationAction.actions(for: NotificationAction.orderSnooze, payload: order).first)
        XCTAssertEqual(a.type, .snoozeOrder)
        XCTAssertEqual(a.payload.refId, "reta")
        // a stock button on the wrong kind of notification does nothing
        XCTAssertTrue(NotificationAction.actions(for: NotificationAction.vialYes, payload: order).isEmpty)
    }

    func testTheAnswerIsJSONTheWebLayerReads() throws {
        let a = PendingAction(type: .vialChange, source: .watch, payload: .init(kind: "change", refId: "reta", answer: "yes"))
        let data = try JSONEncoder().encode(a)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(obj["type"] as? String, "vialChange")
        let p = try XCTUnwrap(obj["payload"] as? [String: Any])
        XCTAssertEqual(p["answer"] as? String, "yes")
        XCTAssertEqual(p["refId"] as? String, "reta")
        XCTAssertEqual(try JSONDecoder().decode(PendingAction.self, from: data), a)
    }

    func testAnAnswerChangesNothingOnScreenUntilThePhoneApplysIt() throws {
        var s = try fixture()
        let before = s.days
        s.apply(PendingAction(type: .vialChange, source: .watch, payload: .init(kind: "change", refId: "reta", answer: "yes")))
        s.apply(PendingAction(type: .snoozeOrder, source: .notification, payload: .init(refId: "reta")))
        XCTAssertEqual(s.days, before)
    }

    func testTheSnapshotCarriesWhichTickLeavesAVialAboutEmpty() throws {
        let s = try fixture()
        let reta = try XCTUnwrap(s.days[0].items.first { $0.refId == "reta" })
        XCTAssertEqual(reta.vialAsk, false)
        var asked = reta
        asked.vialAsk = true
        let data = try JSONEncoder().encode(asked)
        XCTAssertEqual(try JSONDecoder().decode(Snapshot.Item.self, from: data).vialAsk, true)
    }

    func notice(_ id: String, at fire: String) -> Snapshot.Notice {
        Snapshot.Notice(id: id, title: "Order by date", body: "Order Retatrutide by 3 Nov, runs out 17 Nov", fireAt: fire,
                        category: "ORDER", threadId: "pepito.stock",
                        payload: NotificationPayload(kind: "order", route: "supplies", refId: "reta"))
    }

    func testTheWatchPlansTheStockNoticesTheSnapshotCarries() throws {
        var s = try fixture()
        s.stock = Snapshot.Stock(notices: [
            notice("pepito.sched.order.reta.2026-11-03", at: "2026-11-03T09:00:00.000Z"),
            notice("pepito.sched.order.reta.2026-10-01", at: "2026-10-01T09:00:00.000Z"),
        ], outOfStock: ["Retatrutide"])
        let now = ISO8601DateFormatter().date(from: "2026-10-20T08:00:00Z")!
        let plan = WatchReminders.plan(s, now: now)
        let stock = plan.filter { $0.category == "ORDER" }
        XCTAssertEqual(stock.map(\.id), ["pepito.sched.order.reta.2026-11-03"]) // the one already past is not planned
        XCTAssertEqual(stock.first?.body, "Order Retatrutide by 3 Nov, runs out 17 Nov")
        XCTAssertEqual(stock.first?.payload.refId, "reta")
        XCTAssertEqual(stock.first?.threadId, "pepito.stock")
        XCTAssertTrue(stock.first!.id.hasPrefix(NotificationAction.schedulePrefix))
    }

    func testAnOlderSnapshotWithNoStockSectionPlansNoStockNotices() throws {
        var s = try fixture()
        s.stock = nil
        let now = ISO8601DateFormatter().date(from: "2026-10-20T08:00:00Z")!
        XCTAssertTrue(WatchReminders.plan(s, now: now).filter { $0.category == "ORDER" || $0.category == "COUNT" }.isEmpty)
    }

    func testTheStockSectionRoundTrips() throws {
        var s = try fixture()
        s.stock = Snapshot.Stock(notices: [notice("pepito.sched.order.reta.2026-11-03", at: "2026-11-03T09:00:00.000Z")], outOfStock: ["Retatrutide"])
        XCTAssertEqual(try Snapshot.decode(s.encoded()), s)
    }
}

final class SleepLabTests: XCTestCase {
    private func snap(hourSplit: Int = 12) -> Snapshot {
        var s = try! JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: Bundle.module.url(forResource: "snapshot", withExtension: "json", subdirectory: "Fixtures")!))
        s.slotSplitHour = hourSplit
        s.sleep = .init(asNeeded: [
            .init(id: "an-dex", name: "Dexamphetamine", short: "Dex", slot: "AM", units: ["mg"], step: 2.5),
            .init(id: "an-temazepam", name: "Temazepam", short: "Temazepam", slot: "PM", units: ["mg"], step: 5, last: 10, lastUnit: "mg"),
            .init(id: "an-restavit", name: "Restavit", short: "Restavit", slot: "PM", units: ["tablets", "mg"], step: 1, last: 1, lastUnit: "tablets"),
        ])
        return s
    }

    func testTheSlotsItemsComeFirst() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let night = Date(timeIntervalSince1970: 1_792_000_000 - 1_792_000_000.truncatingRemainder(dividingBy: 86400) + 21 * 3600)
        XCTAssertEqual(AsNeededPicker.items(snap(), now: night, calendar: cal).map(\.short), ["Temazepam", "Restavit", "Dex"])
        let morning = night.addingTimeInterval(-13 * 3600)
        XCTAssertEqual(AsNeededPicker.items(snap(), now: morning, calendar: cal).first?.short, "Dex")
        XCTAssertEqual(AsNeededPicker.items(nil), [])
    }

    func testTheAmountStartsAtTheLastOneOrZero() {
        let items = snap().sleep!.asNeeded
        XCTAssertEqual(AsNeededPicker.start(items[0]), 0)
        XCTAssertEqual(AsNeededPicker.start(items[1]), 10)
        XCTAssertEqual(AsNeededPicker.snap(7.4, step: 2.5), 7.5)
        XCTAssertEqual(AsNeededPicker.snap(-3, step: 2.5), 0)
        XCTAssertEqual(AsNeededPicker.words(7.5), "7.5")
        XCTAssertEqual(AsNeededPicker.words(10), "10")
        XCTAssertEqual(AsNeededPicker.unit(items[2]), "tablets")
        XCTAssertEqual(AsNeededPicker.unit(items[0]), "mg")
    }

    func testTheActionCarriesAmountUnitAndTime() throws {
        let t = Date(timeIntervalSince1970: 1_792_000_000)
        let a = PendingAction.asNeeded("an-temazepam", amount: 10, unit: "mg", takenAt: t, source: .watch)
        XCTAssertEqual(a.type, .logAsNeeded)
        XCTAssertEqual(a.payload.refId, "an-temazepam")
        XCTAssertEqual(a.payload.amount, 10)
        XCTAssertEqual(a.payload.takenAt, PendingAction.iso(t))
        let back = try JSONDecoder().decode(PendingAction.self, from: JSONEncoder().encode(a))
        XCTAssertEqual(back, a)
    }

    // MARK: - M5b prompts

    func testTheEveningAndMorningButtonsAreQueuedActions() throws {
        let evening = NotificationPayload(kind: "evening", date: "2026-10-20", route: "evening")
        let nothing = try XCTUnwrap(NotificationAction.actions(for: NotificationAction.eveningNothing, payload: evening).first)
        XCTAssertEqual(nothing.type, .eveningNothing)
        XCTAssertEqual(nothing.payload.date, "2026-10-20")
        XCTAssertTrue(NotificationAction.actions(for: NotificationAction.eveningLog, payload: evening).isEmpty) // opens the sheet instead
        let morning = NotificationPayload(kind: "morning", date: "2026-10-21", route: "sleep")
        let rested = try XCTUnwrap(NotificationAction.actions(for: "pepito.rested.4", payload: morning).first)
        XCTAssertEqual(rested.type, .morningCheck)
        XCTAssertEqual(rested.payload.rested, 4)
        XCTAssertTrue(NotificationAction.actions(for: "pepito.rested.9", payload: morning).isEmpty)
        let dreams = try XCTUnwrap(NotificationAction.actions(for: "pepito.dreams.vivid", payload: morning).first)
        XCTAssertEqual(dreams.payload.dreams, "vivid")
        // one tap each: a rested answer asks about dreams next
        let next = try XCTUnwrap(NotificationAction.followUp(for: "pepito.rested.4", payload: morning))
        XCTAssertEqual(next.category, "MORNING_DREAMS")
        XCTAssertEqual(next.payload.date, "2026-10-21")
        XCTAssertNil(NotificationAction.followUp(for: "pepito.dreams.vivid", payload: morning))
    }

    func testTookDexLogsTheLastAmountNow() throws {
        let p = NotificationPayload(kind: "dose", date: "2026-10-20", slot: "AM", took: .init(refId: "an-dex", amount: 10, unit: "mg"))
        let now = Date(timeIntervalSince1970: 1_792_000_000)
        let a = try XCTUnwrap(NotificationAction.actions(for: NotificationAction.took, payload: p, now: now).first)
        XCTAssertEqual(a.type, .logAsNeeded)
        XCTAssertEqual(a.payload.refId, "an-dex")
        XCTAssertEqual(a.payload.amount, 10)
        XCTAssertEqual(a.payload.takenAt, PendingAction.iso(now))
        let cats = Dictionary(uniqueKeysWithValues: NotificationAction.categories(took: "Dex").map { ($0.0, $0.1.map(\.1)) })
        XCTAssertEqual(cats["DOSE_LOG_PUSH_TOOK"], ["Log", "Skip", "Remind in 30 min", "Push to tomorrow", "Took Dex"])
        XCTAssertEqual(cats["EVENING"], ["Nothing unusual", "Log"])
        XCTAssertEqual(cats["MORNING"], ["1 Not rested", "2", "3", "4", "5 Fully rested"])
        let watch = Dictionary(uniqueKeysWithValues: NotificationAction.watchCategories(took: "Dex").map { ($0.0, $0.1.map(\.1)) })
        XCTAssertEqual(watch["DOSE_LOG_TOOK"], ["Log all", "Skip", "Remind in 30 min", "Took Dex"])
        XCTAssertEqual(watch["MORNING_DREAMS"], ["None remembered", "Normal", "Vivid", "Nightmare"])
    }

    func testAnsweringTakesThePromptOutOfTheWatchsPlan() throws {
        var s = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: Bundle.module.url(forResource: "snapshot", withExtension: "json", subdirectory: "Fixtures")!))
        let ids = { (s: Snapshot) in (s.sleep?.prompts ?? []).map(\.id) }
        XCTAssertTrue(ids(s).contains("pepito.sched.evening.2026-10-20"))
        s.apply(PendingAction(type: .eveningNothing, source: .watch, payload: .init(date: "2026-10-20")))
        XCTAssertFalse(ids(s).contains("pepito.sched.evening.2026-10-20"))
        XCTAssertTrue(ids(s).contains("pepito.sched.evening.2026-10-21"))
        s.apply(PendingAction(type: .morningCheck, source: .notification, payload: .init(date: "2026-10-21", rested: 3)))
        XCTAssertFalse(ids(s).contains("pepito.sched.morning.2026-10-21"))
        // a sedative taken after midnight belongs to the evening before
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let late = try XCTUnwrap(WatchReminders.moment("2026-10-22", "00:40", calendar: cal))
        s.apply(.asNeeded("an-restavit", amount: 1, unit: "tablets", takenAt: late, source: .watch), now: late, calendar: cal)
        XCTAssertFalse(ids(s).contains("pepito.sched.evening.2026-10-21"))
    }

    func testTheBedtimeNudgeIsUnder30PercentAtTheEveningPrompt() {
        let at = Date(timeIntervalSince1970: 1_792_000_000)
        let day = DoseBoard.dateString(at)
        XCTAssertTrue(BedtimeNudge.shouldNudge(battery: 0.24, now: at.addingTimeInterval(600), eveningAt: at, lastNudged: nil))
        XCTAssertFalse(BedtimeNudge.shouldNudge(battery: 0.3, now: at.addingTimeInterval(600), eveningAt: at, lastNudged: nil))
        XCTAssertFalse(BedtimeNudge.shouldNudge(battery: 0.24, now: at.addingTimeInterval(-60), eveningAt: at, lastNudged: nil))
        XCTAssertFalse(BedtimeNudge.shouldNudge(battery: 0.24, now: at.addingTimeInterval(2 * 3600), eveningAt: at, lastNudged: nil))
        XCTAssertFalse(BedtimeNudge.shouldNudge(battery: 0.24, now: at.addingTimeInterval(600), eveningAt: at, lastNudged: day))
        XCTAssertEqual(BedtimeNudge.body(battery: 0.24), "Watch battery is at 24%. Charge it before bed so tonight's sleep is recorded.")
    }

    func testTheEveningSheetSendsTheItemsThenTheAnswer() throws {
        let s = snap()
        XCTAssertEqual(EveningSheetModel.sedatives(s).map(\.short), ["Temazepam", "Restavit"])
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let late = try XCTUnwrap(WatchReminders.moment("2026-10-21", "00:30", calendar: cal))
        let nothing = EveningSheetModel.actions(drinks: 0, factors: [], taken: [], now: late, calendar: cal)
        XCTAssertEqual(nothing.map(\.type), [.eveningNothing])
        XCTAssertEqual(nothing[0].payload.date, "2026-10-20")
        let tem = EveningSheetModel.sedatives(s)[0]
        let some = EveningSheetModel.actions(drinks: 2, factors: ["stress"], taken: [(tem, 10, "mg")], now: late, calendar: cal)
        XCTAssertEqual(some.map(\.type), [.logAsNeeded, .eveningLog])
        XCTAssertEqual(some[1].payload.drinks, 2)
        XCTAssertEqual(some[1].payload.factors, ["stress"])
        XCTAssertEqual(WatchRoute.from(url: URL(string: "pepito://evening")!), .evening)
    }

    func testTheWatchReportsItselfOnlyWhenSomethingChanged() {
        let now = Date(timeIntervalSince1970: 1_792_000_000)
        XCTAssertTrue(WatchStatusReport.shouldSend(last: nil, complication: true, battery: 0.8, now: now))
        let last = WatchStatusReport.Last(complication: true, battery: 0.8, at: now)
        XCTAssertFalse(WatchStatusReport.shouldSend(last: last, complication: true, battery: 0.75, now: now.addingTimeInterval(3600)))
        XCTAssertTrue(WatchStatusReport.shouldSend(last: last, complication: false, battery: 0.8, now: now.addingTimeInterval(60)))
        XCTAssertTrue(WatchStatusReport.shouldSend(last: last, complication: true, battery: 0.65, now: now.addingTimeInterval(60)))
        XCTAssertTrue(WatchStatusReport.shouldSend(last: last, complication: true, battery: 0.8, now: now.addingTimeInterval(7 * 3600)))
        let a = WatchStatusReport.action(complication: true, battery: 0.6789, now: now)
        XCTAssertEqual(a.type, .watchStatus)
        XCTAssertEqual(a.payload.battery, 0.68)
    }
}

final class RestlessnessTests: XCTestCase {
    /// A synthetic night at 10 Hz: still lying one way, a burst of movement, then still lying another way.
    private func night(_ parts: [(minutes: Double, x: Double, y: Double, z: Double, moving: Bool)], start: Double = 1_792_000_000) -> [Restlessness.Second] {
        var acc = Restlessness.Accumulator()
        var t = start
        var seed: UInt64 = 7
        func noise() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 33) / Double(1 << 31) - 0.5
        }
        for p in parts {
            let end = t + p.minutes * 60
            while t < end {
                let jitter = p.moving ? 0.6 : 0.004
                acc.add(t: t, x: p.x + noise() * jitter, y: p.y + noise() * jitter, z: p.z + noise() * jitter)
                t += 0.1
            }
        }
        return acc.finish()
    }

    func testStillWristIsNotMoving() {
        let s = night([(30, 0, 0, 1, false)])
        let sum = Restlessness.summary(s, start: 1_792_000_000, end: 1_792_000_000 + 1800)
        XCTAssertEqual(sum.movementMin, 0)
        XCTAssertEqual(sum.positionChanges, 0)
        XCTAssertEqual(sum.restlessPeriods, 0)
        XCTAssertEqual(sum.series.count, 30)
    }

    func testRollingOverIsAPositionChangeAndABurstIsRestless() {
        let s = night([(20, 0, 0, 1, false), (2, 0, 0, 1, true), (20, 1, 0, 0, false), (3, 1, 0, 0, true), (15, 1, 0, 0, false)])
        let start = 1_792_000_000.0
        let sum = Restlessness.summary(s, start: start, end: start + 60 * 60)
        XCTAssertEqual(sum.movementMin, 5, accuracy: 0.3)
        XCTAssertEqual(sum.positionChanges, 1) // the second burst ends lying the same way
        XCTAssertEqual(sum.restlessPeriods, 2)
        XCTAssertEqual(sum.indexPerHour, 3, accuracy: 0.01)
        XCTAssertEqual(sum.series.count, 60)
        XCTAssertGreaterThan(sum.series[20], 0.9)
        XCTAssertEqual(sum.series[10], 0)
    }

    func testABriefTurnThatDoesNotHoldIsNotAChange() {
        let s = night([(10, 0, 0, 1, false), (0.5, 1, 0, 0, false), (10, 0, 0, 1, false)])
        XCTAssertEqual(Restlessness.positionChanges(s, start: 1_792_000_000, end: 1_792_000_000 + 1230), 0)
    }

    func testTheRecordingStartsEachEveningOnce() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let evening = cal.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: 19))!
        XCTAssertTrue(RestlessRecording.shouldStart(now: evening, lastStart: nil, enabled: true, calendar: cal))
        XCTAssertFalse(RestlessRecording.shouldStart(now: evening, lastStart: evening.addingTimeInterval(-3600), enabled: true, calendar: cal))
        XCTAssertTrue(RestlessRecording.shouldStart(now: evening, lastStart: evening.addingTimeInterval(-86400), enabled: true, calendar: cal))
        XCTAssertFalse(RestlessRecording.shouldStart(now: evening.addingTimeInterval(-6 * 3600), lastStart: nil, enabled: true, calendar: cal))
        XCTAssertFalse(RestlessRecording.shouldStart(now: evening, lastStart: nil, enabled: false, calendar: cal))
    }

    func testRefreshesAndTheMainSleep() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let d = { (h: Int, m: Int) in cal.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: h, minute: m))! }
        XCTAssertEqual(RestlessRecording.nextRefresh(after: d(14, 0), calendar: cal), d(18, 5))
        XCTAssertEqual(RestlessRecording.nextRefresh(after: d(3, 0), calendar: cal), d(6, 30))
        XCTAssertEqual(RestlessRecording.nextRefresh(after: d(20, 0), calendar: cal), d(21, 0))
        XCTAssertEqual(RestlessRecording.nextRefresh(after: d(23, 30), calendar: cal), d(6, 30).addingTimeInterval(86400))
        let main = RestlessRecording.mainSleep([(d(1, 0), d(3, 0)), (d(3, 20), d(7, 0)), (d(14, 0), d(14, 30))])!
        XCTAssertEqual(main.start, d(1, 0))
        XCTAssertEqual(main.end, d(7, 0))
        XCTAssertNil(RestlessRecording.mainSleep([]))
        XCTAssertEqual(RestlessRecording.wakeDate(d(7, 0), calendar: cal), "2026-10-23")
    }
}

final class SleepSoundsTests: XCTestCase {
    func testTheSessionNeverInterruptsOrDegradesHeadphoneAudio() {
        // mixing keeps other apps playing; A2DP keeps AirPods in playback mode; never HFP, never ducking
        XCTAssertEqual(SleepSoundsCore.category, "playAndRecord")
        XCTAssertTrue(SleepSoundsCore.options.contains(.mixWithOthers))
        XCTAssertTrue(SleepSoundsCore.options.contains(.allowBluetoothA2DP))
        XCTAssertFalse(SleepSoundsCore.options.contains(.allowBluetooth))
        XCTAssertFalse(SleepSoundsCore.options.contains(.duckOthers))
        XCTAssertFalse(SleepSoundsCore.options.contains(.defaultToSpeaker))
    }

    func testTheBuiltInMicIsAlwaysTheInput() {
        let ports = [(type: "BluetoothHFP", uid: "airpods"), (type: "MicrophoneBuiltIn", uid: "built-in")]
        XCTAssertEqual(SleepSoundsCore.preferredInput(ports), "built-in")
        XCTAssertNil(SleepSoundsCore.preferredInput([(type: "BluetoothHFP", uid: "airpods")]))
        XCTAssertTrue(SleepSoundsCore.needsReassert(currentInputType: "BluetoothHFP"))
        XCTAssertFalse(SleepSoundsCore.needsReassert(currentInputType: "MicrophoneBuiltIn"))
    }

    func testWindowsBecomeEventsPerLabel() {
        let d = { (t: Double, l: String, c: Double) in SleepSoundsCore.Detection(t: t, duration: 1, label: l, confidence: c) }
        let ev = SleepSoundsCore.events([d(0, "snoring", 0.8), d(1.5, "snoring", 0.9), d(10, "snoring", 0.7), d(5, "cough", 0.95), d(6, "laughter", 0.9), d(20, "snoring", 0.3)])
        XCTAssertEqual(ev.map(\.label), ["snoring", "cough", "snoring"])
        XCTAssertEqual(ev[0], .init(s: 0, e: 2500, label: "snoring", c: 0.9))
        XCTAssertEqual(ev[2].s, 10_000)
    }

    func testLevelsAndLoudMinutes() {
        XCTAssertEqual(SleepSoundsCore.dbfs(rms: 0.1), -20, accuracy: 0.001)
        XCTAssertEqual(SleepSoundsCore.dbfs(rms: 0), -120)
        let levels = SleepSoundsCore.minuteLevels([(0, -60), (30, -62), (60, -40), (125, -61)])
        XCTAssertEqual(levels, [[0, -61], [60_000, -40], [120_000, -61]])
        XCTAssertEqual(SleepSoundsCore.loudMinutes(levels), 1)
    }

    func testItStopsOnItsOwn() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let start = cal.date(from: DateComponents(year: 2026, month: 10, day: 23, hour: 22))!
        XCTAssertNil(SleepSoundsCore.shouldStop(startedAt: start, now: start.addingTimeInterval(4 * 3600), pluggedIn: true, calendar: cal))
        XCTAssertNil(SleepSoundsCore.shouldStop(startedAt: start, now: start.addingTimeInterval(2 * 3600), pluggedIn: false, calendar: cal)) // midnight, not yet 4 am
        XCTAssertEqual(SleepSoundsCore.shouldStop(startedAt: start, now: start.addingTimeInterval(7 * 3600), pluggedIn: false, calendar: cal), .unplugged)
        XCTAssertEqual(SleepSoundsCore.shouldStop(startedAt: start, now: start.addingTimeInterval(11 * 3600), pluggedIn: true, calendar: cal), .tooLong)
    }

    func testAPhoneThatMovedALot() {
        let still = (0..<600).map { (t: Double($0), g: 0.01) }
        XCTAssertEqual(SleepSoundsCore.movingMinutes(still), 0)
        let moved = (0..<600).map { (t: Double($0), g: $0 % 60 < 6 ? 0.2 : 0.01) }
        XCTAssertEqual(SleepSoundsCore.movingMinutes(moved), 10)
    }
}

final class SaunaRatingTests: XCTestCase {
    func testTheRatingStepSendsOneActionMatchedByStart() throws {
        var r = SaunaRatingModel()
        let start = Date(timeIntervalSince1970: 1_792_000_000)
        XCTAssertNil(r.action(sessionStart: start, workoutId: nil)) // skipped: nothing sent
        r.feel = 4
        r.lightheaded = true
        r.water(400); r.water(-100); r.water(5000)
        XCTAssertEqual(r.waterMl, SaunaRatingModel.waterMax)
        r.water(-10000)
        XCTAssertEqual(r.waterMl, 0)
        r.water(500)
        let a = try XCTUnwrap(r.action(sessionStart: start, workoutId: "hk-1"))
        XCTAssertEqual(a.type, .saunaRating)
        XCTAssertEqual(a.payload.start, 1_792_000_000_000)
        XCTAssertEqual(a.payload.feel, 4)
        XCTAssertEqual(a.payload.lightheaded, true)
        XCTAssertEqual(a.payload.waterMl, 500)
        XCTAssertEqual(try JSONDecoder().decode(PendingAction.self, from: JSONEncoder().encode(a)), a)
    }
}

final class SleepSoundsWindowTests: XCTestCase {
    func testTheChargerAutomationOnlyStartsInTheEvening() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let at = { (h: Int) in cal.date(bySettingHour: h, minute: 10, second: 0, of: Date(timeIntervalSince1970: 1_792_000_000))! }
        XCTAssertTrue(SleepSoundsCore.inEveningWindow(at(20), calendar: cal))
        XCTAssertTrue(SleepSoundsCore.inEveningWindow(at(23), calendar: cal))
        XCTAssertTrue(SleepSoundsCore.inEveningWindow(at(3), calendar: cal))
        XCTAssertFalse(SleepSoundsCore.inEveningWindow(at(4), calendar: cal))
        XCTAssertFalse(SleepSoundsCore.inEveningWindow(at(14), calendar: cal))
        XCTAssertFalse(SleepSoundsCore.inEveningWindow(at(19), calendar: cal))
    }
}

final class LateUseTests: XCTestCase {
    func testThresholdsAreFiledUnderTheEvening() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let late = cal.date(from: DateComponents(year: 2026, month: 10, day: 24, hour: 0, minute: 40))!
        XCTAssertEqual(LateUseLog.night(of: late, calendar: cal), "2026-10-23")
        XCTAssertEqual(LateUseLog.night(of: late.addingTimeInterval(-3 * 3600), calendar: cal), "2026-10-23")
        XCTAssertEqual(LateUseLog.minutes(event: "m15"), 15)
        XCTAssertNil(LateUseLog.minutes(event: "x"))
        var log = LateUseLog.record([:], night: "2026-10-23", minutes: 10)
        log = LateUseLog.record(log, night: "2026-10-23", minutes: 5)
        XCTAssertEqual(log["2026-10-23"], 10)
    }

    // MARK: checkpoints, gaps and recovery

    private func session(open: Bool, now: Double, gaps: [SleepSoundsCore.Gap] = [], detections: [SleepSoundsCore.Detection] = []) -> SleepSoundsSession {
        SleepSoundsCore.session(id: "ss-1", start: 1_000_000, now: now, detections: detections, levels: [(1_000, -60), (1_030, -58)],
                                moves: [], room: [], startedBy: "shortcut", gaps: gaps, checkpoints: 2, open: open, stopReason: nil)
    }

    func testASessionIsSavedAsOpenAndKeepsEverythingHeardSoFar() {
        let det = [SleepSoundsCore.Detection(t: 1_100, duration: 5, label: "snoring", confidence: 0.9)]
        let s = session(open: true, now: 1_200_000, detections: det)
        XCTAssertTrue(s.open)
        XCTAssertEqual(s.lastCheckpoint, 1_200_000)
        XCTAssertEqual(s.events.count, 1)
        XCTAssertEqual(s.checkpoints, 2)
        // it round-trips through JSON with its open flag
        let back = try! JSONDecoder().decode(SleepSoundsSession.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(back, s)
    }

    func testAKilledAppLeavesTheNightUpToTheLastCheckpoint() {
        let gap = SleepSoundsCore.Gap(s: 1_100_000, e: 9_999_999, reason: "interrupted") // still open when the app went
        let det = [SleepSoundsCore.Detection(t: 1_050, duration: 5, label: "snoring", confidence: 0.9),
                   SleepSoundsCore.Detection(t: 1_300, duration: 5, label: "snoring", confidence: 0.9)] // after the checkpoint
        var open = session(open: true, now: 1_200_000, gaps: [gap], detections: det)
        open.events = SleepSoundsCore.events(det)
        let r = SleepSoundsCore.recover(open)
        XCTAssertFalse(r.open)
        XCTAssertTrue(r.recovered)
        XCTAssertEqual(r.end, 1_200_000)
        XCTAssertEqual(r.stopReason, "appClosed")
        XCTAssertEqual(r.events.count, 1, "nothing after the checkpoint survives")
        XCTAssertEqual(r.gaps[0].e, 1_200_000, "an open gap is closed at the checkpoint")
        // a finished session is left alone
        let done = session(open: false, now: 1_200_000)
        XCTAssertEqual(SleepSoundsCore.recover(done), done)
    }

    func testFilesWrittenBeforeCheckpointsStillDecode() {
        let old = """
        {"id":"ss-9","start":1000,"end":9000,"events":[],"levels":[],"loudMinutes":0,"movingMinutes":0,"lowConfidence":false,"room":[],"startedBy":"app"}
        """
        let s = try! JSONDecoder().decode(SleepSoundsSession.self, from: Data(old.utf8))
        XCTAssertFalse(s.open)
        XCTAssertEqual(s.lastCheckpoint, 9000)
        XCTAssertEqual(s.gaps, [])
        XCTAssertFalse(s.recovered)
    }

    func testEachResumeMapsAudioTimeToTheClockOnItsOwn() {
        // the first segment began at t=100 s on the clock; after a call the audio timeline restarts at 0 and resumes at t=5000 s
        let first = SleepSoundsCore.SegmentClock(baseWall: 100, baseSeconds: 0)
        let second = SleepSoundsCore.SegmentClock(baseWall: 5000, baseSeconds: 0)
        XCTAssertEqual(first.wall(30), 130)
        XCTAssertEqual(second.wall(30), 5030)
        XCTAssertEqual(SleepSoundsCore.SegmentClock(baseWall: 200, baseSeconds: 12.5).wall(15), 202.5)
    }

    func testTheNewStopReasonsAreNamedForTheLog() {
        XCTAssertEqual(SleepSoundsCore.StopReason.interrupted.rawValue, "interrupted")
        XCTAssertEqual(SleepSoundsCore.StopReason.appClosed.rawValue, "appClosed")
        XCTAssertEqual(SleepSoundsCore.checkpointEverySec, 300)
    }

    // MARK: starting, the log and the notices

    private var utc: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }
    private func ms(_ h: Int, _ m: Int, day: Int = 27) -> Double {
        utc.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m))!.timeIntervalSince1970 * 1000
    }

    func testEveryStartOutcomeIsNamed() {
        let c = SleepSoundsCore.classifyStart
        XCTAssertEqual(c(true, nil, false, true), .started)
        XCTAssertEqual(c(false, nil, false, true), .noPermission)
        XCTAssertEqual(c(true, 561_145_187, true, false), .blockedLocked, "locked wins over the generic code")
        XCTAssertEqual(c(true, 561_145_187, false, false), .blockedBackground)
        XCTAssertEqual(c(true, 561_017_449, false, true), .blockedBackground)
        XCTAssertEqual(c(true, 1234, false, false), .blockedBackground, "an unknown error from the background is still a background block")
        XCTAssertEqual(c(true, 1234, false, true), .audioError)
        XCTAssertEqual(SleepSoundsCore.startFailureWords(.blockedLocked), "The phone was locked, so iOS did not allow the microphone to start.")
        XCTAssertEqual(SleepSoundsCore.startFailureWords(.noPermission), "Microphone access is off. Allow it in Settings.")
    }

    func testTheStartLogKeepsTheNewestEntries() {
        var log: [SleepSoundsCore.LogEntry] = []
        for i in 0..<70 { log = SleepSoundsCore.appended(log, .init(at: Double(i), kind: "start", by: "shortcut", result: "started")) }
        XCTAssertEqual(log.count, 60)
        XCTAssertEqual(log.first?.at, 10)
        let e = SleepSoundsCore.LogEntry(at: 1, kind: "start", by: "shortcut", result: "audioError", error: "The operation couldn't be completed. (com.apple.coreaudio.avfaudio error 561145187.)")
        XCTAssertEqual(try! JSONDecoder().decode(SleepSoundsCore.LogEntry.self, from: JSONEncoder().encode(e)), e)
    }

    func testTheStopNoticeSaysWhenAndWhy() {
        XCTAssertEqual(SleepSoundsCore.timeWords(ms(3, 12), calendar: utc), "3:12 am")
        XCTAssertEqual(SleepSoundsCore.timeWords(ms(0, 5), calendar: utc), "12:05 am")
        XCTAssertEqual(SleepSoundsCore.timeWords(ms(22, 40), calendar: utc), "10:40 pm")
        XCTAssertEqual(SleepSoundsCore.stoppedNotice(reason: "interrupted", atMs: ms(3, 12), calendar: utc),
                       "Sleep sounds stopped recording at 3:12 am. Another app or a call kept the microphone. Tap to start it again.")
        XCTAssertEqual(SleepSoundsCore.stoppedNotice(reason: "appClosed", atMs: ms(3, 12), calendar: utc),
                       "Sleep sounds stopped recording at 3:12 am. The app was closed. Tap to start it again.")
        XCTAssertTrue(SleepSoundsCore.isUnexpected("appClosed"))
        XCTAssertTrue(SleepSoundsCore.isUnexpected("interrupted"))
        XCTAssertFalse(SleepSoundsCore.isUnexpected("focusOff"))
        XCTAssertFalse(SleepSoundsCore.isUnexpected("app"))
        XCTAssertFalse(SleepSoundsCore.isUnexpected("unplugged"))
        XCTAssertEqual(SleepSoundsCore.pausedNotice(sinceMs: ms(3, 12), calendar: utc), "Sleep sounds paused at 3:12 am. Another app or a call has the microphone. It listens again as soon as it can.")
        XCTAssertFalse(SleepSoundsCore.stoppedNotice(reason: "interrupted", atMs: 0, calendar: utc).contains("\u{2014}"))
    }

    func testTheStopAutomationNeverJustSaysItWasNotRunning() {
        let now = ms(7, 30)
        let failed = SleepSoundsCore.LogEntry(at: ms(22, 41, day: 26), kind: "start", by: "shortcut", result: "blockedLocked", error: "!rec")
        XCTAssertEqual(SleepSoundsCore.notRunningWords(lastStart: failed, lastEnd: nil, nowMs: now, calendar: utc),
                       "Sleep sounds never started at 10:41 pm. The phone was locked, so iOS did not allow the microphone to start.")
        XCTAssertEqual(SleepSoundsCore.notRunningWords(lastStart: nil, lastEnd: nil, nowMs: now, calendar: utc),
                       "Sleep sounds did not start last night. Open Pepito+ and tap Start sleep sounds before bed.")
        XCTAssertEqual(SleepSoundsCore.notRunningWords(lastStart: nil, lastEnd: (ms(3, 12), "appClosed"), nowMs: now, calendar: utc),
                       "Sleep sounds stopped at 3:12 am. The app was closed.")
        let ok = SleepSoundsCore.LogEntry(at: ms(22, 41, day: 26), kind: "start", by: "app", result: "started")
        XCTAssertEqual(SleepSoundsCore.notRunningWords(lastStart: ok, lastEnd: (ms(6, 50), "focusOff"), nowMs: now, calendar: utc), "Sleep sounds was not running.")
    }

    func testTheBedtimeCheckIsOneANightAndGoesWhenListeningStarts() {
        let now = utc.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 12, minute: 0))!
        let times = SleepSoundsCore.checkTimes(bedtime: "22:30", now: now, calendar: utc)
        XCTAssertEqual(times.count, 7)
        XCTAssertEqual(times[0].id, "pepito.sounds.check.2026-10-27")
        XCTAssertEqual(utc.component(.hour, from: times[0].fire), 22)
        XCTAssertEqual(utc.component(.minute, from: times[0].fire), 40)
        // after tonight's check has passed, the first one is tomorrow's
        let late = utc.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 23, minute: 0))!
        XCTAssertEqual(SleepSoundsCore.checkTimes(bedtime: "22:30", now: late, calendar: utc)[0].id, "pepito.sounds.check.2026-10-28")
        XCTAssertEqual(SleepSoundsCore.checkTimes(bedtime: "nonsense", now: now, calendar: utc).count, 0)
        // listening at 10:35 pm clears tonight's check and leaves the later nights
        let started = utc.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 22, minute: 35))!
        let gone = SleepSoundsCore.checksToCancel(times, startedAt: started)
        XCTAssertEqual(gone, ["pepito.sounds.check.2026-10-27"])
        XCTAssertEqual(SleepSoundsCore.bedtimeNotice, "Sleep sounds is not listening yet. Tap to start it.")
        XCTAssertEqual(SleepSoundsCore.startFailedNotice(.blockedLocked), "Sleep sounds could not start. The phone was locked, so iOS did not allow the microphone to start. Tap to start it.")
    }

    // MARK: the schedule

    func testTheScheduleWindowRunsAcrossMidnight() {
        let s = SleepSoundsSchedule.standard
        let at = { (d: Int, h: Int, m: Int) in self.utc.date(from: DateComponents(year: 2026, month: 10, day: d, hour: h, minute: m))! }
        XCTAssertTrue(s.contains(at(27, 21, 0), calendar: utc))
        XCTAssertTrue(s.contains(at(27, 23, 59), calendar: utc))
        XCTAssertTrue(s.contains(at(28, 4, 59), calendar: utc))
        XCTAssertFalse(s.contains(at(28, 5, 0), calendar: utc))
        XCTAssertFalse(s.contains(at(27, 20, 59), calendar: utc))
        // a window inside one day
        XCTAssertTrue(SleepSoundsSchedule(on: true, start: "01:00", stop: "06:00").contains(at(27, 3, 0), calendar: utc))
        XCTAssertFalse(SleepSoundsSchedule(on: true, start: "01:00", stop: "06:00").contains(at(27, 23, 0), calendar: utc))
        XCTAssertNil(SleepSoundsSchedule.minutes("25:00"))
        XCTAssertEqual(s.untilWords, "until 5:00")
    }

    func testItStopsAtTheScheduledTimeNeverPastElevenHours() {
        let s = SleepSoundsSchedule.standard
        let start = utc.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 21, minute: 0))!
        let stop = s.stopAfter(start, calendar: utc)!
        XCTAssertEqual(utc.dateComponents([.day, .hour, .minute], from: stop), DateComponents(day: 28, hour: 5, minute: 0))
        XCTAssertEqual(SleepSoundsCore.until(startedAt: start, schedule: s, calendar: utc), stop)
        // started by hand at 1 pm: the next 5 am is 16 h away, so the 11 hour limit wins
        let early = utc.date(from: DateComponents(year: 2026, month: 10, day: 27, hour: 13, minute: 0))!
        XCTAssertEqual(SleepSoundsCore.until(startedAt: early, schedule: s, calendar: utc), early.addingTimeInterval(11 * 3600))
        // schedule off: only the limit
        XCTAssertEqual(SleepSoundsCore.until(startedAt: start, schedule: SleepSoundsSchedule(on: false, start: "21:00", stop: "05:00"), calendar: utc), start.addingTimeInterval(11 * 3600))
        XCTAssertFalse(SleepSoundsCore.isUnexpected("scheduled"))
        XCTAssertEqual(SleepSoundsCore.stopReasonWords("scheduled"), "The schedule ended.")
    }

    func testTheScheduleNeverDoublesUpAndStopsOnTime() {
        XCTAssertFalse(SleepSoundsCore.shouldStartOnSchedule(isRunning: true))
        XCTAssertTrue(SleepSoundsCore.shouldStartOnSchedule(isRunning: false))
        let u = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(SleepSoundsCore.reachedScheduledStop(now: u, until: u))
        XCTAssertFalse(SleepSoundsCore.reachedScheduledStop(now: u.addingTimeInterval(-60), until: u))
        XCTAssertFalse(SleepSoundsCore.reachedScheduledStop(now: u, until: nil))
    }

    func testAFailedScheduledStartFallsBackToATimeSensitiveTap() {
        let f = SleepSoundsCore.startFailedFallback(by: "schedule", result: .blockedBackground)
        XCTAssertEqual(f?.body, "Tap to start Sleep sounds. The app was in the background, so iOS did not allow the microphone to start.")
        XCTAssertEqual(f?.timeSensitive, true)
        XCTAssertEqual(SleepSoundsCore.startFailedFallback(by: "shortcut", result: .noPermission)?.body,
                       "Sleep sounds could not start. Microphone access is off. Allow it in Settings. Tap to start it.")
        XCTAssertNil(SleepSoundsCore.startFailedFallback(by: "app", result: .audioError))
        XCTAssertNil(SleepSoundsCore.startFailedFallback(by: "schedule", result: .started))
        XCTAssertNil(SleepSoundsCore.startFailedFallback(by: "schedule", result: .alreadyRunning))
    }
}

/// Watch sleep mode: the tile and complication by time of day, the movement
/// recording window, the message to the iPhone and its fallback, the morning.
final class SleepModeTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return c
    }()

    private func at(_ s: String) -> Date {
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: s)!
    }

    func testTheComplicationFollowsTheTimeOfDay() {
        let last = Snapshot.LastNight(date: "2026-10-28", asleepMin: 408, score: 80)
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-28 21:00"), night: nil, lastNight: last, calendar: cal), .start)
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-29 02:00"), night: nil, lastNight: last, calendar: cal), .start)
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-28 07:30"), night: nil, lastNight: last, calendar: cal), .score(80))
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-28 14:00"), night: nil, lastNight: Snapshot.LastNight(date: "2026-10-28", asleepMin: 408), calendar: cal), .hours(408))
        let lightsOut = at("2026-10-28 22:40")
        let night = SleepMode.Night(lightsOut: lightsOut)
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-29 01:00"), night: night, lastNight: last, calendar: cal), .sleeping(since: lightsOut))
        // a night never closed with "I'm up" stops counting as asleep after 14 hours
        XCTAssertEqual(SleepMode.complication(now: at("2026-10-29 13:00"), night: night, lastNight: last, calendar: cal), .score(80))
    }

    func testTheHomeTileSaysStartSleepThenLastNight() {
        XCTAssertEqual(SleepMode.tileLine(phase: .evening, lastNight: nil, now: Date()).text, "Start sleep")
        let line = SleepMode.tileLine(phase: .morning, lastNight: Snapshot.LastNight(date: "2026-10-28", asleepMin: 408), now: Date())
        XCTAssertEqual(line.text, "Last night 6 h 48 m")
        XCTAssertEqual(line.short, "6 h 48 m")
        let since = at("2026-10-28 22:40")
        XCTAssertEqual(SleepMode.tileLine(phase: .sleeping(since: since), lastNight: nil, now: at("2026-10-29 00:00")).text, "Sleeping · 1 h 20 m")
        XCTAssertEqual(SleepMode.sinceLightsOut(since, now: at("2026-10-29 00:00")), "1 h 20 m since lights out")
    }

    func testTheMovementRecordingCoversTheNextTenHours() {
        let now = at("2026-10-28 22:40")
        XCTAssertTrue(SleepMode.recordingNeeded(now: now, lastStart: nil))
        // started at 6 pm for 12 hours: runs to 6 am, short of 8:40 am
        XCTAssertTrue(SleepMode.recordingNeeded(now: now, lastStart: at("2026-10-28 18:00")))
        // started at 9 pm: runs to 9 am, covers 10 hours from 10:40 pm
        XCTAssertFalse(SleepMode.recordingNeeded(now: now, lastStart: at("2026-10-28 21:00")))
    }

    func testTheStartMessageRoundTripsAndQueuesTheLightsOut() {
        let t = at("2026-10-28 22:40")
        let msg = SleepMode.message(.start, at: t)
        let back = SleepMode.command(from: msg)
        XCTAssertEqual(back?.command, .start)
        XCTAssertEqual(back?.at, t)
        XCTAssertNil(SleepMode.command(from: ["test": 1.0]))
        let a = SleepMode.action(.start, at: t)
        XCTAssertEqual(a.type, .sleepMode)
        XCTAssertEqual(a.payload.kind, "lightsOut")
        XCTAssertEqual(a.payload.start, t.timeIntervalSince1970 * 1000)
        XCTAssertEqual(SleepMode.action(.up, at: t).payload.kind, "up")
    }

    func testAStartFromTheWatchThatIOSBlocksFallsBackToATap() {
        // the iPhone app is woken in the background by the message: iOS will not open the microphone there
        let fallback = SleepSoundsCore.startFailedFallback(by: SleepMode.startedBy, result: .blockedBackground)
        XCTAssertNotNil(fallback)
        XCTAssertEqual(fallback?.timeSensitive, true)
        XCTAssertNil(SleepSoundsCore.startFailedFallback(by: SleepMode.startedBy, result: .started))
    }

    func testTheMorningShowsOnceHealthHasThatNight() {
        let night = SleepMode.Night(lightsOut: at("2026-10-28 22:40"), upAt: at("2026-10-29 06:50"))
        let old = Snapshot.LastNight(date: "2026-10-28", asleepMin: 400, score: 70)
        XCTAssertNil(SleepMode.morning(lastNight: old, night: night, calendar: cal), "the night before is not this one")
        let new = Snapshot.LastNight(date: "2026-10-29", asleepMin: 408, score: 80, readiness: 64, restless: 3, snoringMin: 17)
        let m = SleepMode.morning(lastNight: new, night: night, calendar: cal)
        XCTAssertEqual(m?.asleepMin, 408)
        XCTAssertEqual(m?.snoringMin, 17)
        // after midnight lights out wakes the same day
        let late = SleepMode.Night(lightsOut: at("2026-10-29 00:30"))
        XCTAssertNotNil(SleepMode.morning(lastNight: new, night: late, calendar: cal))
        // "I'm up" ends the night
        XCTAssertFalse(SleepMode.isSleeping(night, now: at("2026-10-29 07:00")))
        XCTAssertEqual(SleepMode.phase(now: at("2026-10-29 07:00"), night: night, calendar: cal), .morning)
    }
}

final class SleepModeSnapshotTests: XCTestCase {
    func testTheSnapshotCarriesLastNightForTheWatch() throws {
        let s = try fixture()
        XCTAssertEqual(s.sleep?.lastNight?.date, "2026-10-20")
        XCTAssertEqual(s.sleep?.lastNight?.asleepMin, 431)
        XCTAssertEqual(s.sleep?.lastNight?.snoringMin, 17)
    }
}
