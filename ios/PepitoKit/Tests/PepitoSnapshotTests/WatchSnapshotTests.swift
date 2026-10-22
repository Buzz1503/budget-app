#if os(watchOS)
import XCTest
import SwiftUI
import WidgetKit
import PepitoCore
import PepitoTheme
import PepitoWatchUI

/// Every Watch screen at 49 mm (Ultra) and 41 mm, awake and in Always On, and
/// the complications in full colour and accented.
@MainActor
final class WatchSnapshotTests: XCTestCase {

    struct Screen {
        let name: String
        let size: CGSize
        var mm: String
        var metrics: WatchMetrics { WatchMetrics(width: size.width) }
        var corner: CGFloat { metrics.cornerRadius }
        var side: CGFloat { size.width < 190 ? 8 : 10 }
    }
    static let screens = [Screen(name: "49mm", size: CGSize(width: 205, height: 251), mm: "49mm"),
                          Screen(name: "41mm", size: CGSize(width: 176, height: 215), mm: "41mm")]

    /// `running`: the session screen hides the system clock (persistentSystemOverlays).
    enum Chrome { case home(String), child(String), none, running }

    /// A Watch screen: the page background, the clock, the title and back
    /// button watchOS draws, and the content clipped to the display.
    func watch<V: View>(_ s: Screen, _ bg: LinearGradient, chrome: Chrome, aod: Bool, bottom: AnyView? = nil,
                        fullScreen: Bool = false, @ViewBuilder _ v: () -> V) -> some View {
        let shape = RoundedRectangle(cornerRadius: s.corner, style: .continuous)
        return ZStack(alignment: .top) {
            Color.black
            if !aod { bg }
            Group {
                if fullScreen {
                    v().frame(width: s.size.width, height: s.size.height)
                } else {
                    v()
                        .padding(.horizontal, s.side)
                        .padding(.top, 38)
                        .frame(width: s.size.width, height: s.size.height, alignment: .top)
                }
            }
            if case .running = chrome {} else { bar(s, chrome: chrome, aod: aod) }
            if let bottom {
                VStack(spacing: 0) {
                    Spacer()
                    // watchOS fades the content under the bottom toolbar
                    ZStack(alignment: .bottom) {
                        LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                            .frame(height: 64)
                        bottom.padding(.bottom, 8)
                    }
                }
                .frame(width: s.size.width, height: s.size.height)
            }
        }
        .frame(width: s.size.width, height: s.size.height)
        .clipShape(shape)
        .environment(\.watchMetrics, s.metrics)
        .environment(\.isLuminanceReduced, aod)
        .padding(6)
        .background(Color(white: 0.08))
    }

    func bar(_ s: Screen, chrome: Chrome, aod: Bool) -> some View {
        HStack(spacing: 6) {
            switch chrome {
            case .home(let t):
                Text(t).font(.system(size: 15, weight: .semibold)).foregroundStyle(PepitoTheme.Palette.text)
            case .child(let t):
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(.white.opacity(0.18)))
                Text(t).font(.system(size: s.size.width < 190 ? 14 : 15, weight: .semibold)).foregroundStyle(PepitoTheme.Palette.text).lineLimit(1)
            case .none, .running:
                EmptyView()
            }
            Spacer(minLength: 0)
            Text("10:09").font(.system(size: s.size.width < 190 ? 14 : 15, weight: .semibold)).monospacedDigit().foregroundStyle(.white.opacity(aod ? 0.7 : 1))
        }
        .padding(.horizontal, s.side + (s.size.width < 190 ? 0 : 4))
        .padding(.top, 6)
        .frame(width: s.size.width, height: 36, alignment: .center)
    }

    func size(_ s: Screen) -> CGSize { CGSize(width: s.size.width + 12, height: s.size.height + 12) }

    var all: [Rendered] = []

    func shoot<V: View>(_ name: String, _ bg: LinearGradient, chrome: Chrome, bottom: AnyView? = nil, fullScreen: Bool = false,
                        aodToo: Bool = true, @ViewBuilder _ v: @escaping () -> V) {
        for s in Self.screens {
            for aod in aodToo ? [false, true] : [false] {
                let name = "watch-\(s.mm)-\(name)\(aod ? "-aod" : "")"
                if let r = Snap.write(name, size: size(s), scale: 2, {
                    watch(s, bg, chrome: chrome, aod: aod, bottom: aod ? nil : bottom, fullScreen: fullScreen, v)
                }) { all.append(r) }
            }
        }
    }

    // MARK: screens

    func testWatchScreens() {
        typealias BG = PepitoTheme.WatchBackground
        // Home
        let (typ, typNow) = Samples.group
        shoot("home", BG.home, chrome: .home("Pepito+")) { WatchHomeContent(snap: typ, now: typNow, open: { _ in }) }
        shoot("home-all-logged", BG.home, chrome: .home("Pepito+"), aodToo: false) {
            WatchHomeContent(snap: Samples.allLogged.0, now: Samples.allLogged.1, open: { _ in })
        }
        shoot("home-empty", BG.home, chrome: .home("Pepito+"), aodToo: false) { WatchHomeContent(snap: nil, now: typNow, open: { _ in }) }

        // Doses
        func doses(_ name: String, _ sample: (Snapshot, Date), loggedAt: [String: Date] = [:], willSync: Bool = false, aodToo: Bool = true) {
            guard let screen = WatchHome.doseScreen(sample.0, now: sample.1) else { return }
            let verb = screen.rows.first { $0.status == .due }?.verb ?? "Log"
            let bottom = screen.dueCount < 2 ? nil : AnyView(
                WatchLogAllLabel(count: screen.dueCount, verb: verb)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PepitoTheme.Palette.accentForeground)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .background(Capsule().fill(PepitoTheme.Palette.accent))
            )
            shoot("doses-\(name)", BG.doses, chrome: .child(screen.allLogged ? "Doses" : screen.slot.title), bottom: bottom, aodToo: aodToo) {
                if screen.allLogged {
                    WatchAllLoggedContent(next: screen.next)
                } else {
                    WatchDosesContent(screen: screen, loggedAt: loggedAt, willSync: willSync, onLog: { _ in }, onSkip: { _ in })
                }
            }
        }
        doses("typical", Samples.typical)
        doses("group", Samples.group)
        doses("overflow", Samples.overflow, aodToo: false)
        let groupId = Samples.partway.0.days[0].groups.first?.id ?? ""
        doses("logged-row", Samples.partway, loggedAt: [groupId: Samples.at(7, 42)], willSync: true)
        doses("all-logged", Samples.allLogged)
        shoot("doses-paused", BG.doses, chrome: .child("Doses"), aodToo: false) {
            WatchMessageContent(symbol: "pause.circle.fill", title: "Protocol paused", detail: "Until 27 Oct")
        }
        shoot("doses-empty", BG.doses, chrome: .child("Doses"), aodToo: false) {
            WatchMessageContent(symbol: "iphone", title: "Open Pepito+ on your iPhone", detail: "Your doses appear here after that.")
        }

        shoot("doses-vial-question", BG.doses, chrome: .child("Doses"), aodToo: false) {
            WatchVialQuestionContent(name: "Retatrutide", onYes: {}, onStill: {})
        }

        // Sauna: start, warning, target picker
        shoot("sauna-start", BG.sauna, chrome: .child("Sauna")) {
            WatchSaunaStartContent(tempC: 55, targetMin: 20, onStart: {}, onTarget: {})
        }
        shoot("sauna-start-hot", BG.sauna, chrome: .child("Sauna"), aodToo: false) {
            WatchSaunaStartContent(tempC: 80, targetMin: 25, onStart: {}, onTarget: {})
        }
        shoot("sauna-target", BG.sauna, chrome: .child("Target"), aodToo: false) {
            WatchTargetContent(minutes: 25, onDone: {})
        }

        // Sauna: running, by zone, after target, paused, controls
        let now = Date()
        func run(_ minutes: Double, hr: Double?, target: Int = 20, paused: Bool = false) -> SaunaRunState {
            let start = now.addingTimeInterval(-minutes * 60)
            let trace = Samples.heartTrace(minutes: min(10, minutes), from: now.addingTimeInterval(-min(10, minutes) * 60),
                                           startBPM: (hr ?? 100) - 30, endBPM: hr ?? 100)
            return SaunaRunState(startedAt: start, targetMin: target, tempC: 80, rounds: 2, heartRate: hr, maxHR: 182,
                                 floors: [0.5, 0.6, 0.7, 0.8, 0.9], recent: hr == nil ? [] : trace,
                                 pausedSec: 0, pausedAt: paused ? now : nil)
        }
        let runs: [(String, SaunaRunState)] = [
            ("zone1", run(4.2, hr: 98)), ("zone2", run(9.6, hr: 116)), ("zone3", run(12.57, hr: 131)),
            ("zone4", run(16.3, hr: 150)), ("zone5", run(18.9, hr: 168)), ("after-target", run(23.4, hr: 142)),
            ("no-hr", run(1.2, hr: nil)), ("paused", run(8.1, hr: 112, paused: true)),
        ]
        for (name, st) in runs {
            shoot("sauna-running-\(name)", BG.sauna, chrome: .running, fullScreen: true, aodToo: name == "zone3" || name == "after-target") {
                WatchSaunaRunningContent(state: st, now: now)
            }
        }
        shoot("sauna-controls", BG.sauna, chrome: .none, aodToo: false) {
            WatchSaunaControlsContent(paused: false, rounds: 2, onStop: {}, onNextRound: {}, onPause: {})
        }

        // Sauna: summary
        let end = now
        let start = end.addingTimeInterval(-25 * 60 - 10)
        let summary = SaunaSummaryState(start: start, end: end, tempC: 80, rounds: 2, avgHR: 124, peakHR: 151,
                                        zoneMinutes: [3.2, 6.8, 9.1, 4.4, 0.6],
                                        samples: Samples.heartTrace(minutes: 25, from: start, startBPM: 88, endBPM: 148))
        shoot("sauna-summary", BG.sauna, chrome: .child("Summary"), aodToo: false) {
            WatchSaunaSummaryContent(summary: summary, onDone: {})
        }

        // Readiness
        let r: [(String, Snapshot.Readiness?, Date?, String?)] = [
            ("typical", Samples.readiness(72, band: "moderate", label: "Moderate"), nil, "moderate"),
            ("high", Samples.readiness(86, band: "high", label: "High"), nil, "high"),
            ("low", Samples.readiness(38, band: "low", label: "Low"), nil, "low"),
            ("building", Samples.readiness(nil, band: nil, label: nil, status: "building"), nil, nil),
            ("stale", Samples.readiness(72, band: "moderate", label: "Moderate"), Samples.at(6, 30), "moderate"),
            ("empty", nil, nil, nil),
        ]
        for (name, value, asOf, band) in r {
            shoot("readiness-\(name)", BG.readiness(band), chrome: .child("Readiness"), aodToo: name == "typical") {
                WatchReadinessContent(readiness: value, asOf: asOf)
            }
        }

        let watch49 = all.filter { $0.name.contains("49mm") }
        let watch41 = all.filter { $0.name.contains("41mm") }
        Snap.sheet("watch-49mm", watch49, columns: 6, cell: CGSize(width: 217, height: 263))
        Snap.sheet("watch-41mm", watch41, columns: 6, cell: CGSize(width: 188, height: 227))
    }

    // MARK: complications

    func testComplications() {
        var out: [Rendered] = []
        let tint = Color(hex: 0x8FB8FF)
        func face<V: View>(_ size: CGSize, _ mode: SurfaceMode, @ViewBuilder _ v: () -> V) -> some View {
            ZStack {
                Color.black
                v()
                    .frame(width: size.width, height: size.height)
                    .foregroundStyle(.white)
                    .environment(\.surfaceMode, mode)
                    .environment(\.snapshotTint, tint)
            }
        }
        let circular = CGSize(width: 50, height: 50)
        let rect = CGSize(width: 170, height: 60)
        let inline = CGSize(width: 170, height: 20)
        let corner = CGSize(width: 50, height: 50)
        for mode in [SurfaceMode.fullColor, .accented] {
            let m = mode.rawValue
            for (name, rd) in [("typical", Samples.readiness(72, band: "moderate", label: "Moderate")),
                               ("high", Samples.readiness(86, band: "high", label: "High")), ("empty", nil)] as [(String, Snapshot.Readiness?)] {
                if let x = Snap.write("complication-readiness-circular-\(name)-\(m)", size: CGSize(width: 66, height: 66), scale: 2, {
                    face(circular, mode) { ReadinessComplication(readiness: rd) }
                }) { out.append(x) }
            }
            for (name, s) in [("idle", Samples.idle(Samples.fixture()).sauna), ("running", Samples.running().sauna)] {
                if let x = Snap.write("complication-sauna-circular-\(name)-\(m)", size: CGSize(width: 66, height: 66), scale: 2, {
                    face(circular, mode) { SaunaCircularComplication(sauna: s) }
                }) { out.append(x) }
                if let x = Snap.write("complication-sauna-corner-\(name)-\(m)", size: CGSize(width: 66, height: 66), scale: 2, {
                    face(corner, mode) { SaunaCornerComplication(sauna: s) }
                }) { out.append(x) }
            }
            let doses: [(String, (Snapshot?, Date))] = [("typical", Samples.typical), ("overflow", Samples.overflow),
                                                        ("all-logged", Samples.allLogged), ("paused", Samples.paused),
                                                        ("empty", (nil, Samples.at(8)))]
            for (name, (snap, now)) in doses {
                if let x = Snap.write("complication-next-dose-rectangular-\(name)-\(m)", size: CGSize(width: 186, height: 76), scale: 2, {
                    face(rect, mode) { NextDoseComplication(snap: snap, now: now) }
                }) { out.append(x) }
                if let x = Snap.write("complication-next-dose-inline-\(name)-\(m)", size: CGSize(width: 186, height: 36), scale: 2, {
                    face(inline, mode) {
                        NextDoseInlineComplication(snap: snap, now: now).font(.system(size: 13, weight: .semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }) { out.append(x) }
            }
        }
        Snap.sheet("complications", out, columns: 6, cell: CGSize(width: 186, height: 76))
    }
}
#endif
