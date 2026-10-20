import Foundation

/// What a queued action changes on screen, applied to the snapshot straight
/// away so the widget, the Lock Screen and the Watch show the tick (or the
/// running sauna) before the app next runs. The app rewrites the snapshot from
/// the store when it drains the queue, which settles anything this guessed.
public extension Snapshot {

    mutating func setStatus(refIds: [String], kind: Kind, date: String, to status: Status) {
        guard let d = days.firstIndex(where: { $0.date == date }) else { return }
        for i in days[d].items.indices where days[d].items[i].kind == kind && refIds.contains(days[d].items[i].refId) {
            // a settled item is not unsettled by a second tap from another surface
            if days[d].items[i].status == .due { days[d].items[i].status = status }
        }
    }

    /// Apply one action. `now` refreshes the next-dose line.
    mutating func apply(_ action: PendingAction, now: Date = Date(), calendar: Calendar = .current) {
        let p = action.payload
        let date = p.date ?? DoseBoard.dateString(now, calendar: calendar)
        let kind = Kind(rawValue: p.kind ?? "peptide") ?? .peptide
        let refs = p.refIds ?? (p.refId.map { [$0] } ?? [])
        switch action.type {
        case .logDose:
            setStatus(refIds: refs, kind: kind, date: date, to: .logged)
        case .logSlot:
            setStatus(refIds: refs, kind: .peptide, date: date, to: .logged)
            setStatus(refIds: p.supplementIds ?? [], kind: .supplement, date: date, to: .logged)
        case .skipDose:
            setStatus(refIds: refs, kind: kind, date: date, to: .skipped)
        case .pushDose:
            // the dose moves to tomorrow; today it is no longer owed
            if let d = days.firstIndex(where: { $0.date == date }) {
                days[d].items.removeAll { $0.kind == .peptide && refs.contains($0.refId) && $0.status == .due }
            }
        case .snoozeDose:
            break
        case .startSauna:
            if sauna.active == nil {
                sauna.active = Sauna.Active(
                    startedAt: p.startedAt ?? now.timeIntervalSince1970 * 1000,
                    targetMin: p.targetMin ?? sauna.usual.lengthMin,
                    tempC: p.tempC ?? sauna.usual.tempC,
                    rounds: p.rounds ?? 1,
                    source: action.source.rawValue)
            }
        case .stopSauna:
            if let a = sauna.active {
                let stop = p.stoppedAt ?? now.timeIntervalSince1970 * 1000
                let minutes = max(1, Int(((min(stop, a.startedAt + 7_200_000) - a.startedAt) / 60_000).rounded()))
                sauna.week.sessions += 1
                sauna.week.heatMin += minutes
                sauna.active = nil
            }
        case .saunaCompleted:
            if let s = p.start, let e = p.end {
                sauna.week.sessions += 1
                sauna.week.heatMin += max(1, Int(((e - s) / 60_000).rounded()))
            }
            sauna.active = nil
        }
        next = DoseBoard.next(self, now: now, calendar: calendar)
    }
}
