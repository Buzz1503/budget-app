// The Apple Watch screens and complications as plain SwiftUI views. The Watch
// app adds navigation, the Digital Crown, haptics and HealthKit around them;
// the design snapshots render them to PNG at 49 mm and 41 mm, with and
// without Always On.
#if os(watchOS)
import SwiftUI
import PepitoCore
import PepitoTheme

typealias Pal = PepitoTheme.Palette

/// Sizes that follow the screen: the 41 mm case gets slightly smaller heroes.
public struct WatchMetrics: Equatable, Sendable {
    public var width: CGFloat
    public init(width: CGFloat) { self.width = width }
    public var isSmall: Bool { width < 190 }
    public var hero: CGFloat { isSmall ? 48 : 56 }
    public var timer: CGFloat { isSmall ? 40 : 48 }
    public var title: CGFloat { 17 }
    public var body: CGFloat { 15 }
    public var caption: CGFloat { 13 }
    public var tileHeight: CGFloat { 64 }
    public var ring: CGFloat { isSmall ? 88 : 100 }
    /// The screen's corner radius, for the running ring that follows the edge.
    public var cornerRadius: CGFloat { (width * 0.27).rounded() }
}

private struct WatchMetricsKey: EnvironmentKey { static let defaultValue = WatchMetrics(width: 205) }

public extension EnvironmentValues {
    var watchMetrics: WatchMetrics {
        get { self[WatchMetricsKey.self] }
        set { self[WatchMetricsKey.self] = newValue }
    }
}

/// The main action: a full-width accent capsule with a dark label.
public struct WatchPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isLuminanceReduced) private var dimmed
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(dimmed ? Pal.accent : Pal.accentForeground)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Capsule().fill(dimmed ? Pal.accent.opacity(0.18) : Pal.accent))
            .opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Capsule())
    }
}

/// A quieter full-width or round action. `selected` is a chosen option in a
/// row of them (a unit, a rating): light fill, dark label, like the iPhone's chips.
public struct WatchSecondaryButtonStyle: ButtonStyle {
    public var height: CGFloat
    public var selected: Bool
    public init(height: CGFloat = 44, selected: Bool = false) { self.height = height; self.selected = selected }
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(selected ? Pal.bg : Pal.text)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Capsule().fill(selected ? Pal.text.opacity(configuration.isPressed ? 0.8 : 1)
                                                : Color.white.opacity(configuration.isPressed ? 0.24 : 0.16)))
            .contentShape(Capsule())
    }
}

/// A Home tile: full width, at least 64 pt, symbol, title and one live line.
public struct WatchTileStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .padding(.horizontal, PepitoTheme.Space.s12)
            .background(RoundedRectangle(cornerRadius: PepitoTheme.Radius.large, style: .continuous)
                .fill(Color.white.opacity(configuration.isPressed ? 0.2 : 0.12)))
            .contentShape(RoundedRectangle(cornerRadius: PepitoTheme.Radius.large, style: .continuous))
    }
}

public extension View {
    /// Double tap (watchOS 11) runs this button.
    @ViewBuilder func pepitoPrimaryGesture(_ enabled: Bool = true) -> some View {
        if #available(watchOS 11.0, *), enabled {
            self.handGestureShortcut(.primaryAction)
        } else {
            self
        }
    }
}

enum Clock {
    /// "7:42 am"
    static func time(_ d: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: d)
        let h = c.hour ?? 0, m = c.minute ?? 0
        return "\(h % 12 == 0 ? 12 : h % 12):\(String(format: "%02d", m)) \(h < 12 ? "am" : "pm")"
    }

    /// "12:04", "1:02:09"; without seconds "12 min".
    static func elapsed(_ t: TimeInterval, seconds: Bool) -> String {
        let total = max(0, Int(t))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if !seconds { return h > 0 ? "\(h) h \(m) min" : "\(m) min" }
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
#endif
