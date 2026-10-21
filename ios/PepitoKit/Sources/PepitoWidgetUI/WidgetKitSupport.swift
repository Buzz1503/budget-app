// The iPhone widgets and the sauna Live Activity, as plain SwiftUI views over
// the snapshot. The widget extension wraps them in WidgetKit (timelines,
// intents, container backgrounds); the design snapshots render them to PNG.
// Buttons come in through WidgetActions, because the App Intents they run
// live in the app and the extension.
#if os(iOS)
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme

/// What a tap does. The extension supplies Button(intent:) wrappers; the
/// snapshots use `inert`, which draws the same label without a button.
public struct WidgetActions {
    public var tick: (_ rowId: String, _ label: AnyView) -> AnyView
    public var startSauna: (_ label: AnyView) -> AnyView
    public var stopSauna: (_ label: AnyView) -> AnyView

    public init(tick: @escaping (String, AnyView) -> AnyView,
                startSauna: @escaping (AnyView) -> AnyView,
                stopSauna: @escaping (AnyView) -> AnyView) {
        self.tick = tick; self.startSauna = startSauna; self.stopSauna = stopSauna
    }

    public static let inert = WidgetActions(tick: { _, l in l }, startSauna: { $0 }, stopSauna: { $0 })
}

private struct WidgetActionsKey: EnvironmentKey { static let defaultValue = WidgetActions.inert }
private struct StandByKey: EnvironmentKey { static let defaultValue = false }

public extension EnvironmentValues {
    var widgetActions: WidgetActions {
        get { self[WidgetActionsKey.self] }
        set { self[WidgetActionsKey.self] = newValue }
    }
    /// StandBy (no container background): bigger hero numbers, no small captions.
    var isStandBy: Bool {
        get { self[StandByKey.self] }
        set { self[StandByKey.self] = newValue }
    }
}

public extension SurfaceMode {
    init(_ mode: WidgetRenderingMode) {
        switch mode {
        case .accented: self = .accented
        case .vibrant: self = .vibrant
        default: self = .fullColor
        }
    }
}

typealias Pal = PepitoTheme.Palette
typealias WT = PepitoTheme.WidgetType

/// Colours that change with the rendering mode. Outside full colour only
/// white at different strengths is used, so the system's tint or vibrancy
/// reads it the way it is meant.
struct Ink {
    let mode: SurfaceMode
    /// Only in the design snapshots: the system's tint for the accent group.
    var tint: Color? = nil
    var base: Color { mode.isColor ? Pal.text : .white }
    /// The accent where it means done, progress or the main action.
    var accent: Color { mode.isColor ? Pal.accent : (mode == .accented ? tint ?? .white : .white) }
    var track: Color { .white.opacity(mode.isColor ? 0.14 : 0.22) }
    var buttonFill: Color { mode.isColor ? Pal.accent : (mode == .accented ? (tint ?? .white).opacity(0.3) : .white.opacity(0.2)) }
    var buttonLabel: Color { mode.isColor ? Pal.accentForeground : (mode == .accented ? tint ?? .white : .white) }
    var neutralFill: Color { mode.isColor ? .white : .white.opacity(0.2) }
    var neutralLabel: Color { mode.isColor ? .black : .white }
    func band(_ b: String?) -> Color { mode.isColor ? PepitoTheme.bandColor(b) : .white }
    var sauna: Color { mode.isColor ? Pal.sauna : .white }
}

/// A full-width capsule button label: the Log, Start and Stop buttons.
struct CapsuleLabel: View {
    let title: String
    let symbol: String?
    let fill: Color
    let label: Color
    var height: CGFloat = PepitoTheme.minTap

    var body: some View {
        HStack(spacing: PepitoTheme.Space.s4) {
            if let symbol { Image(systemName: symbol).font(.system(size: WT.title, weight: .bold)) }
            Text(title).font(WT.titleFont())
        }
        .foregroundStyle(label)
        .frame(maxWidth: .infinity, minHeight: height)
        .background(Capsule().fill(fill))
        .contentShape(Capsule())
    }
}

/// Progress to a moment, live. ProgressView(timerInterval:) in a widget; a
/// still ring at the same point in the design snapshots, which cannot draw it.
struct TimerRing: View {
    let range: ClosedRange<Date>
    let tint: Color
    var track: Color = .white.opacity(0.14)
    var lineWidth: CGFloat = 4
    @Environment(\.isDesignSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            let total = range.upperBound.timeIntervalSince(range.lowerBound)
            let f = total > 0 ? min(1, max(0, Date().timeIntervalSince(range.lowerBound) / total)) : 0
            Gauge(value: f) { EmptyView() }
                .gaugeStyle(RingGaugeStyle(lineWidth: lineWidth, tint: tint, track: track))
        } else {
            ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.circular)
                .tint(tint)
        }
    }
}

/// The same as a thin bar.
struct TimerBar: View {
    let range: ClosedRange<Date>
    let tint: Color
    @Environment(\.isDesignSnapshot) private var snapshot

    var body: some View {
        if snapshot {
            let total = range.upperBound.timeIntervalSince(range.lowerBound)
            StillBar(fraction: total > 0 ? min(1, max(0, Date().timeIntervalSince(range.lowerBound) / total)) : 0, tint: tint)
        } else {
            ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                .progressViewStyle(.linear)
                .tint(tint)
        }
    }
}

/// A thin bar held at one point (a paused session, and the design snapshots).
struct StillBar: View {
    let fraction: Double
    let tint: Color
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18))
                Capsule().fill(tint).frame(width: max(4, geo.size.width * fraction))
            }
        }
        .frame(height: 4)
    }
}

enum WidgetText {
    /// "Until 22 Oct" from "2026-10-22".
    static func until(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        return "Until \(p[2]) \(months[max(0, min(11, p[1] - 1))])"
    }

    /// "8:00 pm" from "20:00".
    static func clockFull(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard let h = parts.first else { return "" }
        let m = parts.count > 1 ? parts[1] : 0
        return "\(h % 12 == 0 ? 12 : h % 12):\(String(format: "%02d", m)) \(h < 12 ? "am" : "pm")"
    }

    /// "30 units" to "30u", for the Lock Screen line.
    static func shortUnits(_ units: String?) -> String? {
        guard let u = units, let n = u.split(separator: " ").first else { return nil }
        return "\(n)u"
    }

    static func names(_ row: DoseBoard.Row) -> String { row.items.map(\.name).joined(separator: " + ") }

    /// "Reta 3 mg · 30u", or a group's names and total: "BPC-157 + TB-500 · 50u".
    static func rowLine(_ row: DoseBoard.Row) -> String {
        if row.isGroup { return "\(names(row)) · \(shortUnits(WatchHome.doseLine(row)) ?? "")" }
        guard let i = row.items.first else { return row.title }
        return ["\(i.name) \(i.dose)", shortUnits(i.units)].compactMap { $0 }.joined(separator: " · ")
    }

    /// "8:00 pm", or "Tomorrow 7:00 am".
    static func when(_ n: DoseBoard.NextRow, now: Date, calendar: Calendar = .current) -> String {
        let t = clockFull(n.time)
        return n.date == DoseBoard.dateString(now, calendar: calendar) ? t : "Tomorrow \(t)"
    }
}
#endif
