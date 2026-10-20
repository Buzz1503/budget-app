// The v28 design tokens, ported from src/index.css, for every native surface:
// the widgets and Live Activity, the Watch app and the Watch widgets.
//
// Dark only. Near-black ground, colour only where it carries meaning (the
// accent for done and good, amber for a warning, coral for danger), tabular
// numbers for anything that counts, spacing on 4/8/12/16/20/24/32/40/56 and
// radii 10/14/20/pill. SF Pro on iPhone and SF Compact on the Watch (the
// system font picks the right one) at the same weights as the app.
#if canImport(SwiftUI)
import SwiftUI

public enum PepitoTheme {

    // MARK: colour (exact hex from :root in src/index.css)

    public enum Palette {
        /// --bg #080a12
        public static let bg = Color(hex: 0x080A12)
        /// --surface-solid #141a2b
        public static let surfaceSolid = Color(hex: 0x141A2B)
        /// --surface rgba(255,255,255,0.05)
        public static let surface = Color.white.opacity(0.05)
        /// --surface2 / --surface-sunk rgba(255,255,255,0.09)
        public static let surfaceSunk = Color.white.opacity(0.09)
        /// --border rgba(255,255,255,0.10)
        public static let border = Color.white.opacity(0.10)
        /// --text #f4f6fb
        public static let text = Color(hex: 0xF4F6FB)
        /// --text-2 / --muted #949ab2
        public static let text2 = Color(hex: 0x949AB2)
        /// --text-3 #6f7690
        public static let text3 = Color(hex: 0x6F7690)
        /// --accent / --good / --lime #b4f13a
        public static let accent = Color(hex: 0xB4F13A)
        /// --accent-fg #0c1200, text on the accent
        public static let accentForeground = Color(hex: 0x0C1200)
        /// --warn / --amber #ffb020
        public static let warn = Color(hex: 0xFFB020)
        /// --danger / --coral #ff6b8a
        public static let danger = Color(hex: 0xFF6B8A)
        /// --info / --indigo #6d6bff
        public static let info = Color(hex: 0x6D6BFF)
        /// --series-sauna #f2a65a
        public static let sauna = Color(hex: 0xF2A65A)

        public static let good = accent
    }

    /// Readiness band colours, as on Home (bands.js): low danger, moderate warn, high good.
    public static func bandColor(_ band: String?) -> Color {
        switch band {
        case "high": return Palette.good
        case "moderate": return Palette.warn
        case "low": return Palette.danger
        default: return Palette.text3
        }
    }

    // MARK: spacing 4/8/12/16/20/24/32/40/56

    public enum Space {
        public static let s4: CGFloat = 4
        public static let s8: CGFloat = 8
        public static let s12: CGFloat = 12
        public static let s16: CGFloat = 16
        public static let s20: CGFloat = 20
        public static let s24: CGFloat = 24
        public static let s32: CGFloat = 32
        public static let s40: CGFloat = 40
        public static let s56: CGFloat = 56
    }

    // MARK: radii 10/14/20/pill

    public enum Radius {
        public static let small: CGFloat = 10
        public static let medium: CGFloat = 14
        public static let large: CGFloat = 20
        public static let pill: CGFloat = 999
    }

    /// The smallest tap target on iPhone.
    public static let minTap: CGFloat = 44

    // MARK: type scale (.t-* classes), relative to Dynamic Type

    public enum Typography {
        /// .t-display 28 / 900
        public static let display = Font.system(size: 28, weight: .black, design: .default)
        /// .t-h1 24 / 900
        public static let h1 = Font.system(.title2, design: .default).weight(.black)
        /// .t-h2 18 / 800
        public static let h2 = Font.system(.headline, design: .default).weight(.heavy)
        /// .t-body 15 / 500
        public static let body = Font.system(.subheadline, design: .default).weight(.medium)
        /// .t-label 14 / 700
        public static let label = Font.system(.subheadline, design: .default).weight(.bold)
        /// .t-caption 11 / 800, uppercase, tracked
        public static let caption = Font.system(.caption2, design: .default).weight(.heavy)
        /// .t-metric 34 / 900, tabular
        public static let metric = Font.system(size: 34, weight: .black, design: .default).monospacedDigit()
        /// .t-metric-sm 20 / 800, tabular
        public static let metricSmall = Font.system(.title3, design: .default).weight(.heavy).monospacedDigit()
        /// small print: 12 / 500
        public static let small = Font.system(.caption, design: .default).weight(.medium)
    }
}

public extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/// The caption style: small, heavy, uppercase and tracked, in the third text colour.
public struct PepitoCaption: ViewModifier {
    public init() {}
    public func body(content: Content) -> some View {
        content
            .font(PepitoTheme.Typography.caption)
            .textCase(.uppercase)
            .tracking(0.9)
            .foregroundStyle(PepitoTheme.Palette.text3)
    }
}

/// A card: the surface with its hairline border at the large radius.
public struct PepitoCard: ViewModifier {
    public var padding: CGFloat
    public init(padding: CGFloat = PepitoTheme.Space.s16) { self.padding = padding }
    public func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: PepitoTheme.Radius.large, style: .continuous)
                    .fill(PepitoTheme.Palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: PepitoTheme.Radius.large, style: .continuous)
                    .strokeBorder(PepitoTheme.Palette.border, lineWidth: 1)
            )
    }
}

public extension View {
    func pepitoCaption() -> some View { modifier(PepitoCaption()) }
    func pepitoCard(padding: CGFloat = PepitoTheme.Space.s16) -> some View { modifier(PepitoCard(padding: padding)) }
}
#endif
