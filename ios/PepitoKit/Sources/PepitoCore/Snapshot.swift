import Foundation

/// The snapshot the web layer writes (src/native/snapshot.js). Every native
/// surface reads it and nothing else, so a widget can never disagree with Home.
/// Doses, units, draw groups and wording all arrive ready to show: native code
/// never recomputes them.
public struct Snapshot: Codable, Equatable, Sendable {
    public static let supportedSchema = 1

    public var schema: Int
    public var generatedAt: String
    public var today: String
    public var slotTimes: SlotTimes
    public var slotSplitHour: Int
    public var days: [Day]
    public var next: NextDose?
    public var paused: Paused
    public var readiness: Readiness?
    public var sauna: Sauna
    public var watch: WatchInfo
    public var notifications: NotificationInfo?

    public struct SlotTimes: Codable, Equatable, Sendable {
        public var AM: String
        public var PM: String
        public init(AM: String, PM: String) { self.AM = AM; self.PM = PM }
        public func time(for slot: Slot) -> String { slot == .am ? AM : PM }
    }

    public struct Day: Codable, Equatable, Sendable {
        public var date: String
        public var items: [Item]
        public var groups: [Group]
        public init(date: String, items: [Item], groups: [Group]) {
            self.date = date; self.items = items; self.groups = groups
        }
    }

    public struct Item: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var refId: String
        public var kind: Kind
        public var name: String
        public var compound: String
        public var dose: String
        public var units: String?
        public var line: String
        public var form: String
        public var slot: Slot
        public var status: Status
        public var groupId: String?
        public var verb: String
        public var speech: String
        public var canPush: Bool

        public init(id: String, refId: String, kind: Kind, name: String, compound: String, dose: String, units: String?,
                    line: String, form: String, slot: Slot, status: Status, groupId: String?, verb: String,
                    speech: String, canPush: Bool) {
            self.id = id; self.refId = refId; self.kind = kind; self.name = name; self.compound = compound
            self.dose = dose; self.units = units; self.line = line; self.form = form; self.slot = slot
            self.status = status; self.groupId = groupId; self.verb = verb; self.speech = speech; self.canPush = canPush
        }
    }

    public struct Group: Codable, Equatable, Identifiable, Sendable {
        public var id: String
        public var date: String
        public var slot: Slot
        public var itemIds: [String]
        public var refIds: [String]
        public var title: String
        public var line: String
        public var speech: String
    }

    public enum Kind: String, Codable, Sendable { case peptide, supplement }
    public enum Slot: String, Codable, Sendable, CaseIterable {
        case am = "AM", pm = "PM"
        public var title: String { self == .am ? "AM doses" : "PM doses" }
    }
    public enum Status: String, Codable, Sendable { case due, logged, skipped }

    public struct NextDose: Codable, Equatable, Sendable {
        public var date: String
        public var slot: Slot
        public var time: String
        public var count: Int
        public var line: String
        public var label: String
    }

    public struct Paused: Codable, Equatable, Sendable {
        public var active: Bool
        public var reason: String?
        public var until: String?
        public var wholeProtocol: Bool
        public init(active: Bool, reason: String?, until: String?, wholeProtocol: Bool) {
            self.active = active; self.reason = reason; self.until = until; self.wholeProtocol = wholeProtocol
        }
    }

    public struct Readiness: Codable, Equatable, Sendable {
        public var score: Int?
        public var band: String?
        public var bandLabel: String?
        public var status: String
        public var asOf: String?
        public var rhr: Double?
        public var rhrDelta: Double?
        public var hrv: Double?
        public var hrvDelta: Double?
        public var sleepMin: Double?
    }

    public struct Sauna: Codable, Equatable, Sendable {
        public var week: Week
        public var active: Active?
        public var usual: Usual

        public struct Week: Codable, Equatable, Sendable {
            public var sessions: Int
            public var target: Int
            public var heatMin: Int
        }
        public struct Active: Codable, Equatable, Sendable {
            /// epoch milliseconds, like the web timer
            public var startedAt: Double
            public var targetMin: Int
            public var tempC: Int
            public var rounds: Int
            public var source: String?
            public init(startedAt: Double, targetMin: Int, tempC: Int, rounds: Int, source: String?) {
                self.startedAt = startedAt; self.targetMin = targetMin; self.tempC = tempC; self.rounds = rounds; self.source = source
            }
            public var startDate: Date { Date(timeIntervalSince1970: startedAt / 1000) }
            public var targetDate: Date { startDate.addingTimeInterval(TimeInterval(targetMin * 60)) }
        }
        public struct Usual: Codable, Equatable, Sendable {
            public var lengthMin: Int
            public var tempC: Int
        }
    }

    public struct WatchInfo: Codable, Equatable, Sendable {
        public var maxHR: Int
        public var zoneFloors: [Double]
        public var countTowardMove: Bool
    }

    public struct NotificationInfo: Codable, Equatable, Sendable {
        public var timeSensitive: Bool
        /// "watch", "iphone" or "both": where dose reminders go (3C). Older snapshots have none.
        public var remindOn: String?
        public var doses: Bool?
        public var nudges: Bool?
        public var nudgeDelayMin: Int?
        public init(timeSensitive: Bool, remindOn: String? = nil, doses: Bool? = nil, nudges: Bool? = nil, nudgeDelayMin: Int? = nil) {
            self.timeSensitive = timeSensitive; self.remindOn = remindOn; self.doses = doses
            self.nudges = nudges; self.nudgeDelayMin = nudgeDelayMin
        }
    }
}

public extension Snapshot {
    static func decode(_ data: Data) throws -> Snapshot {
        try JSONDecoder().decode(Snapshot.self, from: data)
    }

    func encoded() throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(self)
    }

    /// The day for a local date, if the snapshot still covers it.
    func day(_ date: String) -> Day? { days.first { $0.date == date } }

    /// A group by id, on any day.
    func group(_ id: String) -> Group? {
        for d in days { if let g = d.groups.first(where: { $0.id == id }) { return g } }
        return nil
    }
}
