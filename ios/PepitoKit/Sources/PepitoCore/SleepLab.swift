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
