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
        XCTAssertEqual(s.days.map(\.date), ["2026-10-20", "2026-10-21", "2026-10-22"])
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

final class WatchLaunchTests: XCTestCase {
    func testSaunaFirstThenDosesThenReadiness() throws {
        var s = try fixture()
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Sydney")!
        let morning = cal.date(from: DateComponents(year: 2026, month: 10, day: 20, hour: 8))!
        XCTAssertEqual(WatchLaunch.screen(for: s, now: morning, calendar: cal), .sauna)
        s.sauna.active = nil
        XCTAssertEqual(WatchLaunch.screen(for: s, now: morning, calendar: cal), .today)
        for d in s.days.indices { for i in s.days[d].items.indices { s.days[d].items[i].status = .logged } }
        XCTAssertEqual(WatchLaunch.screen(for: s, now: morning, calendar: cal), .readiness)
        XCTAssertEqual(WatchLaunch.screen(for: nil, now: morning), .readiness)
    }

    func testReadinessOlderThanSixHoursShowsItsTime() throws {
        let s = try fixture()
        let asOf = ISO8601DateFormatter().date(from: "2026-10-20T06:30:00Z")!
        XCTAssertFalse(WatchLaunch.readinessIsStale(s, now: asOf.addingTimeInterval(5 * 3600)))
        XCTAssertTrue(WatchLaunch.readinessIsStale(s, now: asOf.addingTimeInterval(7 * 3600)))
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
