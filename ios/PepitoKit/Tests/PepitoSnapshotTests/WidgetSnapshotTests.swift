#if os(iOS)
import XCTest
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme
import PepitoWidgetUI

/// iPhone widgets in every family, rendering mode and state, the StandBy
/// look, and the sauna Live Activity on the Lock Screen and in the Dynamic Island.
@MainActor
final class WidgetSnapshotTests: XCTestCase {

    static let small = CGSize(width: 170, height: 170)
    static let medium = CGSize(width: 364, height: 170)
    static let circular = CGSize(width: 76, height: 76)
    static let rectangular = CGSize(width: 172, height: 76)
    static let inline = CGSize(width: 234, height: 22)
    /// The tint the system gives the accent group in accented mode, for the emulation.
    static let tint = Color(hex: 0x8FB8FF)

    static let homeModes: [SurfaceMode] = [.fullColor, .accented]
    static let doseStates: [(String, (Snapshot?, Date))] = [
        ("empty", (nil, Samples.at(8))),
        ("typical", Samples.typical),
        ("group", Samples.group),
        ("overflow", Samples.overflow),
        ("partway", Samples.partway),
        ("all-logged", Samples.allLogged),
        ("paused", Samples.paused),
    ]

    // MARK: frames

    /// A Home Screen widget on a dark wallpaper, with its container and default margins.
    func home<V: View>(_ size: CGSize, _ mode: SurfaceMode, @ViewBuilder _ v: () -> V) -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return ZStack {
            Wallpaper()
            v()
                .padding(16)
                .frame(width: size.width, height: size.height)
                .background(shape.fill(mode == .accented ? AnyShapeStyle(Color(hex: 0x1B2230).opacity(0.92)) : AnyShapeStyle(PepitoTheme.Palette.bg)))
                .clipShape(shape)
                .environment(\.surfaceMode, mode)
                .environment(\.snapshotTint, Self.tint)
                .environment(\.widgetActions, .inert)
        }
    }

    /// A Lock Screen accessory, drawn white on the wallpaper as vibrancy does.
    func lock<V: View>(_ mode: SurfaceMode = .vibrant, @ViewBuilder _ v: () -> V) -> some View {
        ZStack {
            Wallpaper(lock: true)
            v()
                .foregroundStyle(.white)
                .environment(\.surfaceMode, mode)
                .environment(\.snapshotTint, Self.tint)
                .padding(12)
        }
    }

    /// StandBy: no container, black, the widget scaled up by the system.
    func standBy<V: View>(_ mode: SurfaceMode, @ViewBuilder _ v: () -> V) -> some View {
        ZStack {
            Color.black
            v()
                .padding(8)
                .environment(\.surfaceMode, mode)
                .environment(\.isStandBy, true)
                .colorMultiply(mode == .vibrant ? Color(hex: 0xFF4A3D) : .white)
        }
    }

    func pad(_ s: CGSize, _ by: CGFloat = 24) -> CGSize { CGSize(width: s.width + by, height: s.height + by) }

    // MARK: tests

    func testDoseWidgets() {
        var smalls: [Rendered] = []
        var mediums: [Rendered] = []
        for (state, (snap, now)) in Self.doseStates {
            let model = DoseWidgetState(snap, now: now)
            for mode in Self.homeModes {
                if let r = Snap.write("widget-next-dose-small-\(state)-\(mode.rawValue)", size: pad(Self.small), scale: 3, {
                    home(Self.small, mode) { NextDoseSmallView(state: model) }
                }) { smalls.append(r) }
                if let r = Snap.write("widget-today-medium-\(state)-\(mode.rawValue)", size: pad(Self.medium), scale: 3, {
                    home(Self.medium, mode) { TodayMediumView(state: model) }
                }) { mediums.append(r) }
            }
        }
        Snap.sheet("widgets-next-dose", smalls, columns: 4, cell: CGSize(width: 194, height: 194))
        Snap.sheet("widgets-today", mediums, columns: 2, cell: CGSize(width: 388, height: 194))
    }

    func testReadinessAndSaunaWidgets() {
        var out: [Rendered] = []
        let asOf = Samples.at(6, 30)
        let readiness: [(String, Snapshot.Readiness?, Date?)] = [
            ("typical", Samples.readiness(72, band: "moderate", label: "Moderate"), nil),
            ("high", Samples.readiness(86, band: "high", label: "High"), nil),
            ("low", Samples.readiness(38, band: "low", label: "Low"), nil),
            ("building", Samples.readiness(nil, band: nil, label: nil, status: "building"), nil),
            ("stale", Samples.readiness(72, band: "moderate", label: "Moderate"), asOf),
            ("empty", nil, nil),
        ]
        for (state, r, stale) in readiness {
            for mode in Self.homeModes {
                if let x = Snap.write("widget-readiness-small-\(state)-\(mode.rawValue)", size: pad(Self.small), scale: 3, {
                    home(Self.small, mode) { ReadinessSmallView(readiness: r, stale: stale) }
                }) { out.append(x) }
            }
        }
        var met = Samples.idle(Samples.fixture())
        met.sauna.week.sessions = 4
        let sauna: [(String, Snapshot.Sauna?)] = [
            ("idle", Samples.idle(Samples.fixture()).sauna),
            ("target-met", met.sauna),
            ("running", Samples.running().sauna),
            ("over-target", Samples.running(minutes: 26.2).sauna),
            ("empty", nil),
        ]
        for (state, s) in sauna {
            for mode in Self.homeModes {
                if let x = Snap.write("widget-sauna-small-\(state)-\(mode.rawValue)", size: pad(Self.small), scale: 3, {
                    home(Self.small, mode) { SaunaSmallView(sauna: s) }
                }) { out.append(x) }
            }
        }
        Snap.sheet("widgets-readiness-sauna", out, columns: 4, cell: CGSize(width: 194, height: 194))
    }

    func testLockScreenWidgets() {
        var out: [Rendered] = []
        let snaps: [(String, (Snapshot?, Date))] = [
            ("typical", Samples.typical), ("group", Samples.group), ("all-logged", Samples.allLogged),
            ("paused", Samples.paused), ("empty", (nil, Samples.at(8))),
        ]
        for (state, (snap, now)) in snaps {
            if let x = Snap.write("lock-next-dose-rectangular-\(state)-vibrant", size: pad(Self.rectangular), scale: 3, {
                lock { NextDoseRectangularView(snap: snap, now: now).frame(width: Self.rectangular.width, height: Self.rectangular.height) }
            }) { out.append(x) }
            if let x = Snap.write("lock-next-dose-inline-\(state)-vibrant", size: pad(Self.inline), scale: 3, {
                lock { NextDoseInlineContent(snap: snap, now: now).font(.system(size: 15, weight: .semibold)).frame(width: Self.inline.width, height: Self.inline.height, alignment: .leading) }
            }) { out.append(x) }
        }
        let circ: [(String, Snapshot?)] = [
            ("typical", Samples.typical.0), ("empty", nil), ("sauna-running", Samples.running()),
        ]
        for (state, snap) in circ {
            for mode in [SurfaceMode.vibrant, .accented] {
                if let x = Snap.write("lock-readiness-circular-\(state)-\(mode.rawValue)", size: pad(Self.circular), scale: 3, {
                    lock(mode) { ReadinessCircularView(snap: snap).frame(width: Self.circular.width, height: Self.circular.height) }
                }) { out.append(x) }
            }
        }
        Snap.sheet("lock-screen", out, columns: 4, cell: CGSize(width: 240, height: 110))
    }

    func testStandBy() {
        var out: [Rendered] = []
        for mode in [SurfaceMode.fullColor, .vibrant] {
            let (snap, now) = Samples.typical
            let items: [(String, AnyView)] = [
                ("next-dose", AnyView(NextDoseSmallView(state: DoseWidgetState(snap, now: now)))),
                ("next-dose-all-logged", AnyView(NextDoseSmallView(state: DoseWidgetState(Samples.allLogged.0, now: Samples.allLogged.1)))),
                ("readiness", AnyView(ReadinessSmallView(readiness: Samples.readiness(72, band: "moderate", label: "Moderate")))),
                ("sauna", AnyView(SaunaSmallView(sauna: Samples.idle(Samples.fixture()).sauna))),
                ("sauna-running", AnyView(SaunaSmallView(sauna: Samples.running().sauna))),
            ]
            for (name, view) in items {
                if let x = Snap.write("standby-\(name)-\(mode.rawValue)", size: Self.small, scale: 3, {
                    standBy(mode) { view }
                }) { out.append(x) }
            }
        }
        Snap.sheet("standby", out, columns: 5, cell: CGSize(width: 170, height: 170))
    }

    func testLiveActivity() {
        var out: [Rendered] = []
        let now = Date()
        func live(_ minutes: Double, hr: Int?, paused: Bool = false, target: Int = 20) -> SaunaLive {
            let start = now.addingTimeInterval(-minutes * 60)
            return SaunaLive(startedAt: start, targetAt: start.addingTimeInterval(Double(target * 60)), tempC: 80, rounds: 2,
                             heartRate: hr, pausedAt: paused ? now : nil)
        }
        let states: [(String, SaunaLive)] = [
            ("typical", live(12.57, hr: nil)),
            ("watch-hr", live(12.57, hr: 128)),
            ("over-target", live(26.2, hr: 141)),
            ("paused", live(8.1, hr: 112, paused: true)),
        ]
        let lockSize = CGSize(width: 364, height: 132)
        for (state, l) in states {
            if let x = Snap.write("live-activity-lock-\(state)", size: pad(lockSize), scale: 3, {
                ZStack {
                    Wallpaper(lock: true)
                    SaunaLockScreenView(live: l)
                        .frame(width: lockSize.width, height: lockSize.height)
                        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(PepitoTheme.Palette.bg))
                        .environment(\.widgetActions, .inert)
                }
            }) { out.append(x) }
            if let x = Snap.write("live-activity-island-expanded-\(state)", size: CGSize(width: 395, height: 184), scale: 3, {
                Island.expanded(l)
            }) { out.append(x) }
            if let x = Snap.write("live-activity-island-compact-\(state)", size: CGSize(width: 260, height: 61), scale: 3, {
                Island.compact(l)
            }) { out.append(x) }
        }
        if let x = Snap.write("live-activity-island-minimal", size: CGSize(width: 61, height: 61), scale: 3, {
            Island.minimal(live(12.57, hr: nil))
        }) { out.append(x) }
        Snap.sheet("live-activity", out, columns: 3, cell: CGSize(width: 395, height: 184))
    }
}

/// A plain dark wallpaper, so a widget is seen the way it sits on a Home Screen.
struct Wallpaper: View {
    var lock = false
    var body: some View {
        LinearGradient(colors: lock ? [Color(hex: 0x2B3550), Color(hex: 0x101421)] : [Color(hex: 0x23293A), Color(hex: 0x0D1018)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// The Dynamic Island's black shapes around the regions it gives a Live Activity.
enum Island {
    static func expanded(_ l: SaunaLive) -> some View {
        ZStack {
            Wallpaper(lock: true)
            VStack(spacing: 8) {
                HStack(alignment: .center) {
                    SaunaIslandExpanded.leading(l)
                    SaunaIslandExpanded.center(l)
                    SaunaIslandExpanded.trailing(l)
                }
                SaunaIslandExpanded.bottom(l)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(width: 371, height: 160)
            .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))
            .environment(\.widgetActions, .inert)
        }
    }

    static func compact(_ l: SaunaLive) -> some View {
        ZStack {
            Wallpaper(lock: true)
            HStack(spacing: 0) {
                SaunaIslandCompactLeading().frame(width: 52)
                Spacer(minLength: 126)
                SaunaIslandCompactTrailing(live: l).frame(width: 56)
            }
            .padding(.horizontal, 8)
            .frame(width: 250, height: 37)
            .background(Capsule().fill(.black))
        }
    }

    static func minimal(_ l: SaunaLive) -> some View {
        ZStack {
            Wallpaper(lock: true)
            SaunaIslandMinimal(live: l)
                .padding(6)
                .frame(width: 37, height: 37)
                .background(Circle().fill(.black))
        }
    }
}
#endif
