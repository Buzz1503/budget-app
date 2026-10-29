import Foundation

/// Sleep Lab on the Watch: the as-needed items for the slot you are in, the
/// amount picker's rules, and the actions it sends. Nothing is suggested: the
/// amount starts at your last one, or at zero.
public enum AsNeededPicker {
    /// The items for a slot (morning before the split hour, evening after), then the rest.
    public static func items(_ snap: Snapshot?, now: Date = Date(), calendar: Calendar = .current) -> [Snapshot.AsNeeded] {
        guard let all = snap?.sleep?.asNeeded, !all.isEmpty else { return [] }
        let split = snap?.slotSplitHour ?? 12
        let slot = calendar.component(.hour, from: now) < split ? "AM" : "PM"
        return all.filter { $0.slot == slot } + all.filter { $0.slot != slot }
    }

    /// Where the Crown starts: the last amount, else zero.
    public static func start(_ item: Snapshot.AsNeeded) -> Double { max(0, item.last ?? 0) }

    /// A Crown value snapped to the item's step, never below zero.
    public static func snap(_ value: Double, step: Double) -> Double {
        guard step > 0 else { return max(0, value) }
        return max(0, (value / step).rounded() * step)
    }

    /// "7.5" or "10": no trailing zeros.
    public static func words(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%g", (value * 1000).rounded() / 1000)
    }

    /// The unit to start with: the last one used if it is one of the item's, else its first.
    public static func unit(_ item: Snapshot.AsNeeded) -> String {
        if let u = item.lastUnit, item.units.contains(u) { return u }
        return item.units.first ?? ""
    }
}

public extension PendingAction {
    /// An as-needed item taken now (or at `takenAt`), from the Watch or a notification.
    static func asNeeded(_ id: String, amount: Double, unit: String, takenAt: Date = Date(), source: Source) -> PendingAction {
        PendingAction(type: .logAsNeeded, at: takenAt, source: source,
                      payload: .init(refId: id, amount: amount, unit: unit, takenAt: PendingAction.iso(takenAt)))
    }
}

/// The bedtime nudge: the Watch checks its own battery at the evening prompt
/// and, under 30%, asks for a charge before bed so the night is recorded.
public enum BedtimeNudge {
    public static let floor = 0.3
    /// How long after the evening prompt a background refresh still counts as "at" it.
    public static let windowMin = 60.0

    public static func shouldNudge(battery: Double?, now: Date, eveningAt: Date?, lastNudged: String?, calendar: Calendar = .current) -> Bool {
        guard let b = battery, b >= 0, b < floor, let at = eveningAt else { return false }
        let since = now.timeIntervalSince(at)
        guard since >= 0, since <= windowMin * 60 else { return false }
        return lastNudged != DoseBoard.dateString(at, calendar: calendar)
    }

    public static let title = "Charge your Watch"
    public static func body(battery: Double) -> String {
        "Watch battery is at \(Int((battery * 100).rounded()))%. Charge it before bed so tonight's sleep is recorded."
    }
}

/// What the Watch tells the iPhone about itself for Sleep setup: a Pepito
/// complication on the face, the battery, and the movement recording (when a
/// window was last asked for, what asked, and what the last read found). Sent
/// when any of these changes, or every six hours, so the queue does not fill
/// with the same report.
public enum WatchStatusReport {
    public struct Last: Codable, Equatable, Sendable {
        public var complication: Bool
        public var battery: Double
        public var at: Date
        public var motionAt: Date?
        public var motionResult: String?
        public init(complication: Bool, battery: Double, at: Date, motionAt: Date? = nil, motionResult: String? = nil) {
            self.complication = complication; self.battery = battery; self.at = at; self.motionAt = motionAt; self.motionResult = motionResult
        }
    }

    public static func shouldSend(last: Last?, complication: Bool, battery: Double, now: Date, motionAt: Date? = nil, motionResult: String? = nil) -> Bool {
        guard let l = last else { return true }
        return l.complication != complication || abs(l.battery - battery) >= 0.1 || now.timeIntervalSince(l.at) >= 6 * 3600
            || l.motionAt != motionAt || l.motionResult != motionResult
    }

    /// The movement recording rides on fields the payload already has: `start` is when a
    /// window was last asked for (epoch ms), `kind` what asked, `answer` what the last read found.
    public static func action(complication: Bool, battery: Double, now: Date = Date(),
                              motionAt: Date? = nil, motionBy: RestlessRecording.Trigger? = nil, motionResult: String? = nil) -> PendingAction {
        PendingAction(type: .watchStatus, at: now, source: .watch,
                      payload: .init(kind: motionBy?.rawValue, answer: motionResult,
                                     start: motionAt.map { ($0.timeIntervalSince1970 * 1000).rounded() },
                                     complication: complication, battery: (battery * 100).rounded() / 100))
    }
}

/// The Watch's evening sheet, from the evening prompt's Log: the evening
/// as-needed items first with your last amounts filled in, then drinks, then
/// the other factors as quick toggles. Nothing is prefilled as taken.
public enum EveningSheetModel {
    /// Evening items, the ones with a last amount first.
    public static func sedatives(_ snap: Snapshot?) -> [Snapshot.AsNeeded] {
        let pm = (snap?.sleep?.asNeeded ?? []).filter { $0.slot == "PM" }
        return pm.filter { $0.last != nil } + pm.filter { $0.last == nil }
    }

    public static func toggles(_ snap: Snapshot?) -> [Snapshot.Toggle] { snap?.sleep?.toggles ?? [] }

    /// What Save sends: each item taken now, then the evening's answer. With
    /// nothing at all chosen it is "Nothing unusual" (every factor no).
    public static func actions(drinks: Int, factors: [String], taken: [(item: Snapshot.AsNeeded, amount: Double, unit: String)],
                               now: Date = Date(), calendar: Calendar = .current) -> [PendingAction] {
        let date = Snapshot.eveningOf(now, calendar: calendar)
        let items = taken.filter { $0.amount > 0 }.map { PendingAction.asNeeded($0.item.id, amount: $0.amount, unit: $0.unit, takenAt: now, source: .watch) }
        if drinks <= 0 && factors.isEmpty && items.isEmpty {
            return [PendingAction(type: .eveningNothing, at: now, source: .watch, payload: .init(date: date))]
        }
        return items + [PendingAction(type: .eveningLog, at: now, source: .watch, payload: .init(date: date, drinks: max(0, drinks), factors: factors))]
    }
}

/// The optional quick step after a Watch sauna session: how it felt 1 to 5,
/// Lightheaded, Headache, Cramps, Electrolytes after, and water in ml (the
/// iPhone writes it to Apple Health). Matched on the iPhone by the session's start.
public struct SaunaRatingModel: Equatable, Sendable {
    public var feel: Int?
    public var lightheaded = false
    public var headache = false
    public var cramps = false
    public var electrolytes = false
    public var waterMl = 0

    public init() {}

    public static let waterStep = 100
    public static let waterMax = 3000

    public mutating func water(_ delta: Int) { waterMl = min(Self.waterMax, max(0, waterMl + delta)) }

    public var isEmpty: Bool { feel == nil && !lightheaded && !headache && !cramps && !electrolytes && waterMl == 0 }

    /// Nothing chosen sends nothing.
    public func action(sessionStart: Date, workoutId: String?, now: Date = Date()) -> PendingAction? {
        guard !isEmpty else { return nil }
        return PendingAction(type: .saunaRating, at: now, source: .watch,
                             payload: .init(start: sessionStart.timeIntervalSince1970 * 1000, workoutId: workoutId,
                                            feel: feel, lightheaded: lightheaded, headache: headache, cramps: cramps,
                                            electrolytes: electrolytes, waterMl: waterMl > 0 ? waterMl : nil))
    }
}
