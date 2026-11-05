import Foundation
import AppIntents
import SwiftUI
import PepitoCore
import PepitoTheme

// App Intents shared by the widgets (interactive buttons), Siri, Shortcuts and
// the Action Button. Each one only queues an action through ActionSink: the web
// layer applies it with the same logic as an in-app tap. Compiled into the app
// and the widget extension; the sauna intents are Live Activity intents, so
// they run in the app's process even when tapped on a widget, which is what
// lets them start the Live Activity and the Watch workout.

// MARK: - a dose (or a draw-together group) as Siri and Shortcuts see it

struct DoseEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Dose")
    static var defaultQuery = DoseQuery()

    /// a snapshot item id, or a group id for a draw-together group
    var id: String
    var title: String
    var line: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(line)")
    }

    init(row: DoseBoard.Row) {
        id = row.id
        title = row.title
        line = row.line
    }
}

struct DoseQuery: EntityQuery {
    /// Everything due today, in slot order.
    func suggestedEntities() async throws -> [DoseEntity] {
        DoseIntentSupport.dueToday().map(DoseEntity.init(row:))
    }

    func entities(for identifiers: [String]) async throws -> [DoseEntity] {
        DoseIntentSupport.rows(today: false).filter { identifiers.contains($0.id) }.map(DoseEntity.init(row:))
    }
}

enum DoseIntentSupport {
    static func snapshot() -> Snapshot? { SharedStore.shared().readSnapshot() }

    /// Every row the snapshot has, today first.
    static func rows(today: Bool = true) -> [DoseBoard.Row] {
        guard let s = snapshot() else { return [] }
        let days = today ? Array(s.days.prefix(1)) : s.days
        return days.flatMap { d in Snapshot.Slot.allCases.flatMap { DoseBoard.rows(s, date: d.date, slot: $0) } }
    }

    static func dueToday() -> [DoseBoard.Row] {
        guard let s = snapshot() else { return [] }
        let today = DoseBoard.dateString(Date())
        return Snapshot.Slot.allCases.flatMap { DoseBoard.rows(s, date: today, slot: $0) }.filter { $0.status == .due }
    }

    static func row(id: String) -> DoseBoard.Row? { rows(today: false).first { $0.id == id } }

    /// The queued action for a row: a group logs as one draw.
    static func logAction(_ row: DoseBoard.Row, source: PendingAction.Source) -> PendingAction {
        switch row.content {
        case .group(let g, _): return .log(group: g, source: source)
        case .single(let i): return .log(i, date: row.date, source: source)
        }
    }

    static func skipActions(_ row: DoseBoard.Row, source: PendingAction.Source) -> [PendingAction] {
        row.items.filter { $0.status == .due }.map { .skip($0, date: row.date, source: source) }
    }
}

// MARK: - doses

struct LogDoseIntent: AppIntent {
    static var title: LocalizedStringResource = "Log dose"
    static var description = IntentDescription("Log one dose from my protocol, or a draw-together group in one go.")
    static var openAppWhenRun = false

    @Parameter(title: "Dose") var dose: DoseEntity

    init() {}
    init(row: DoseBoard.Row) { dose = DoseEntity(row: row) }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let row = DoseIntentSupport.row(id: dose.id) else {
            return .result(dialog: "That dose is not in today's protocol any more.")
        }
        guard row.status == .due else { return .result(dialog: "\(row.title) is already logged.") }
        ActionSink.record(DoseIntentSupport.logAction(row, source: .siri))
        return .result(dialog: "\(row.verb == "Take" ? "Taken" : "Logged"): \(row.line).")
    }
}

/// The widget's tick: the same as LogDoseIntent, quiet, keyed by row id.
struct TickDoseIntent: AppIntent {
    static var title: LocalizedStringResource = "Tick dose"
    static var isDiscoverable = false
    static var openAppWhenRun = false

    @Parameter(title: "Row") var rowId: String

    init() {}
    init(rowId: String) { self.rowId = rowId }

    func perform() async throws -> some IntentResult {
        if let row = DoseIntentSupport.row(id: rowId), row.status == .due {
            ActionSink.record(DoseIntentSupport.logAction(row, source: .widget))
        }
        return .result()
    }
}

struct SkipDoseIntent: AppIntent {
    static var title: LocalizedStringResource = "Skip dose"
    static var description = IntentDescription("Skip one dose today. Nothing is taken from stock.")
    static var openAppWhenRun = false

    @Parameter(title: "Dose") var dose: DoseEntity

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let row = DoseIntentSupport.row(id: dose.id), row.status == .due else {
            return .result(dialog: "Nothing to skip there.")
        }
        ActionSink.record(DoseIntentSupport.skipActions(row, source: .siri))
        return .result(dialog: "Skipped \(row.title) today.")
    }
}

struct LogDueDosesIntent: AppIntent {
    static var title: LocalizedStringResource = "Log my doses"
    static var description = IntentDescription("Log everything due in the current slot, each draw-together group as one draw.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = DoseIntentSupport.snapshot() else { return .result(dialog: "Open Pepito+ once first.") }
        let due = DoseBoard.dueNow(s, now: Date())
        guard !due.rows.isEmpty else { return .result(dialog: "Nothing due in the \(due.slot.rawValue) slot.") }
        ActionSink.record(due.rows.map { DoseIntentSupport.logAction($0, source: .siri) })
        let n = due.rows.flatMap(\.items).count
        return .result(dialog: "Logged \(n) \(n == 1 ? "item" : "items") from \(due.slot.title).")
    }
}

// MARK: - sauna

struct StartSaunaIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Start sauna"
    static var description = IntentDescription("Start a sauna session with your usual length and temperature, or the ones you say.")
    static var openAppWhenRun = false

    @Parameter(title: "Minutes", inclusiveRange: (1, 120)) var minutes: Int?
    @Parameter(title: "Temperature (C)", inclusiveRange: (30, 120)) var temperature: Int?

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = DoseIntentSupport.snapshot() else { return .result(dialog: "Open Pepito+ once first.") }
        if s.sauna.active != nil { return .result(dialog: "A sauna session is already running.") }
        let start = Date()
        let target = minutes ?? s.sauna.usual.lengthMin
        let temp = temperature ?? s.sauna.usual.tempC
        ActionSink.record(PendingAction(type: .startSauna, at: start, source: .siri,
                                        payload: .init(startedAt: start.timeIntervalSince1970 * 1000, targetMin: target, tempC: temp, rounds: 1)))
        await SaunaEffects.started(at: start, targetMin: target, tempC: temp)
        return .result(dialog: "Sauna started: \(target) min at \(temp) C.")
    }
}

struct StopSaunaIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop sauna"
    static var description = IntentDescription("Stop the running sauna session and save it.")
    static var openAppWhenRun = false

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let active = DoseIntentSupport.snapshot()?.sauna.active else {
            return .result(dialog: "No sauna session is running.")
        }
        let stop = Date()
        ActionSink.record(PendingAction(type: .stopSauna, at: stop, source: .siri,
                                        payload: .init(stoppedAt: stop.timeIntervalSince1970 * 1000)))
        await SaunaEffects.stopped()
        let minutes = max(1, Int((stop.timeIntervalSince(active.startDate) / 60).rounded()))
        return .result(dialog: "Sauna saved: \(minutes) min.")
    }
}

// MARK: - readiness

struct ShowReadinessIntent: AppIntent {
    static var title: LocalizedStringResource = "Show readiness"
    static var description = IntentDescription("Today's readiness score and band.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        let r = DoseIntentSupport.snapshot()?.readiness
        let spoken: String
        if let r, let score = r.score, let band = r.bandLabel {
            spoken = "Readiness \(score), \(band.lowercased())."
        } else if r == nil {
            spoken = "No readiness yet. Connect Apple Health in Pepito+."
        } else {
            spoken = r?.status == "building" ? "Readiness is still building a baseline." : "Not enough data from last night."
        }
        return .result(dialog: "\(spoken)", view: ReadinessSnippet(readiness: r))
    }
}

/// The card Siri shows under the spoken answer.
struct ReadinessSnippet: View {
    let readiness: Snapshot.Readiness?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: PepitoTheme.Space.s12) {
            Text(readiness?.score.map(String.init) ?? "–")
                .font(PepitoTheme.Typography.metric)
                .foregroundStyle(PepitoTheme.Palette.text)
            VStack(alignment: .leading, spacing: PepitoTheme.Space.s4) {
                Text(readiness?.bandLabel ?? "Readiness")
                    .font(PepitoTheme.Typography.h2)
                    .foregroundStyle(PepitoTheme.bandColor(readiness?.band))
                if let rhr = readiness?.rhr, let hrv = readiness?.hrv {
                    Text("RHR \(Int(rhr.rounded())), HRV \(Int(hrv.rounded())) ms")
                        .font(PepitoTheme.Typography.small.monospacedDigit())
                        .foregroundStyle(PepitoTheme.Palette.text2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(PepitoTheme.Space.s16)
        .background(PepitoTheme.Palette.bg)
        .accessibilityElement(children: .combine)
    }
}
