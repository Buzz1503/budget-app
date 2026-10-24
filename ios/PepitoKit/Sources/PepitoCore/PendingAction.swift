import Foundation

/// One thing a widget, a notification, Siri or the Watch asked for. Appended
/// to the queue in the App Group; the web layer applies each one once, by id,
/// through the same store actions an in-app tap uses (src/native/actions.js).
/// Native code never writes a log itself.
public struct PendingAction: Codable, Equatable, Identifiable, Sendable {
    public enum ActionType: String, Codable, Sendable {
        case logDose, logSlot, skipDose, snoozeDose, pushDose, startSauna, stopSauna, saunaCompleted
        /// The answer to "Start a new one?" (payload.answer: yes, still or notyet; payload.kind: change or expired)
        case vialChange
        /// "Remind me in 3 days" on an order-by notice
        case snoozeOrder
        /// Sleep Lab: an as-needed item (payload.refId, amount, unit, takenAt)
        case logAsNeeded
        /// The evening factors: all no (eveningNothing), or drinks and factor ids (eveningLog)
        case eveningNothing, eveningLog
        /// The morning check from the Watch or a notification (payload.rested, dreams)
        case morningCheck
        /// The Watch's overnight movement summary (payload.restless)
        case restlessness
        /// What the Watch reports about itself (payload.complication, battery 0 to 1)
        case watchStatus
    }
    public enum Source: String, Codable, Sendable {
        case widget, notification, siri, watch, liveActivity, app
    }

    public var id: String
    public var type: ActionType
    /// ISO 8601, when the tap happened (a dose logged offline keeps its time)
    public var at: String
    public var source: Source
    public var payload: Payload

    public init(id: String = UUID().uuidString, type: ActionType, at: Date = Date(), source: Source, payload: Payload) {
        self.id = id
        self.type = type
        self.at = PendingAction.iso(at)
        self.source = source
        self.payload = payload
    }

    public static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: d)
    }

    /// Every field any action uses; each type reads its own.
    public struct Payload: Codable, Equatable, Sendable {
        public var date: String?
        public var slot: String?
        public var kind: String?
        public var refId: String?
        public var refIds: [String]?
        public var supplementIds: [String]?
        public var group: Bool?
        /// vialChange: yes, still or notyet
        public var answer: String?
        // sauna
        public var startedAt: Double?
        public var stoppedAt: Double?
        public var targetMin: Int?
        public var tempC: Int?
        public var rounds: Int?
        public var autoEnded: Bool?
        // a finished Watch session
        public var start: Double?
        public var end: Double?
        public var type: String?
        public var avgHR: Int?
        public var peakHR: Int?
        /// [epoch seconds, bpm] at 5-second resolution
        public var samples: [[Double]]?
        public var roundSplits: [Double]?
        public var workoutId: String?
        /// The cool-down after Stop: when the sauna was left (epoch ms) and
        /// [epoch seconds, bpm] for up to 5 minutes from then.
        public var exitAt: Double?
        public var coolDown: [[Double]]?
        // Sleep Lab
        public var amount: Double?
        public var unit: String?
        /// ISO 8601, when an as-needed item was taken (defaults to `at`)
        public var takenAt: String?
        public var drinks: Int?
        public var factors: [String]?
        public var rested: Int?
        public var dreams: String?
        public var restless: RestlessSummary?
        public var complication: Bool?
        public var battery: Double?

        public init(date: String? = nil, slot: String? = nil, kind: String? = nil, refId: String? = nil, refIds: [String]? = nil,
                    supplementIds: [String]? = nil, group: Bool? = nil, answer: String? = nil, startedAt: Double? = nil, stoppedAt: Double? = nil,
                    targetMin: Int? = nil, tempC: Int? = nil, rounds: Int? = nil, autoEnded: Bool? = nil,
                    start: Double? = nil, end: Double? = nil, type: String? = nil, avgHR: Int? = nil, peakHR: Int? = nil,
                    samples: [[Double]]? = nil, roundSplits: [Double]? = nil, workoutId: String? = nil,
                    exitAt: Double? = nil, coolDown: [[Double]]? = nil,
                    amount: Double? = nil, unit: String? = nil, takenAt: String? = nil, drinks: Int? = nil, factors: [String]? = nil,
                    rested: Int? = nil, dreams: String? = nil, restless: RestlessSummary? = nil,
                    complication: Bool? = nil, battery: Double? = nil) {
            self.date = date; self.slot = slot; self.kind = kind; self.refId = refId; self.refIds = refIds
            self.supplementIds = supplementIds; self.group = group; self.answer = answer; self.startedAt = startedAt; self.stoppedAt = stoppedAt
            self.targetMin = targetMin; self.tempC = tempC; self.rounds = rounds; self.autoEnded = autoEnded
            self.start = start; self.end = end; self.type = type; self.avgHR = avgHR; self.peakHR = peakHR
            self.samples = samples; self.roundSplits = roundSplits; self.workoutId = workoutId
            self.exitAt = exitAt; self.coolDown = coolDown
            self.amount = amount; self.unit = unit; self.takenAt = takenAt; self.drinks = drinks; self.factors = factors
            self.rested = rested; self.dreams = dreams; self.restless = restless
            self.complication = complication; self.battery = battery
        }
    }
}

public extension PendingAction {
    /// Log one item, or a whole draw-together group as one draw.
    static func log(_ item: Snapshot.Item, date: String, source: Source, at: Date = Date()) -> PendingAction {
        PendingAction(type: .logDose, at: at, source: source,
                      payload: Payload(date: date, kind: item.kind.rawValue, refId: item.refId))
    }

    static func log(group: Snapshot.Group, source: Source, at: Date = Date()) -> PendingAction {
        PendingAction(type: .logDose, at: at, source: source,
                      payload: Payload(date: group.date, kind: "peptide", refIds: group.refIds, group: true))
    }

    static func skip(_ item: Snapshot.Item, date: String, source: Source, at: Date = Date()) -> PendingAction {
        PendingAction(type: .skipDose, at: at, source: source,
                      payload: Payload(date: date, kind: item.kind.rawValue, refId: item.refId))
    }
}
