// Renders every native surface to PNG in design-snapshots/ at the repository
// root, so the design can be reviewed image by image. ImageRenderer draws the
// same views the widgets, the Live Activity and the Watch app use; the frame
// around each (wallpaper, widget shape, Watch screen, clock, back button) is
// drawn here, and accented and vibrant modes are emulated by the views
// themselves (SurfaceMode) since no public API renders them as the system does.
#if os(iOS) || os(watchOS)
import XCTest
import SwiftUI
import ImageIO
import UniformTypeIdentifiers
import PepitoCore
import PepitoTheme

enum SnapshotOut {
    /// <repo>/design-snapshots
    static let dir: URL = {
        var u = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { u.deleteLastPathComponent() }
        return u.appendingPathComponent("design-snapshots", isDirectory: true)
    }()

    static func ensure() {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}

struct Rendered {
    let name: String
    let image: CGImage
    let scale: CGFloat
}

@MainActor
enum Snap {
    /// Render a view at a fixed size and write it as <name>.png.
    @discardableResult
    static func write<V: View>(_ name: String, size: CGSize, scale: CGFloat, @ViewBuilder _ view: () -> V) -> Rendered? {
        SnapshotOut.ensure()
        let content = view()
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, .dark)
        let r = ImageRenderer(content: content)
        r.scale = scale
        r.proposedSize = ProposedViewSize(size)
        guard let cg = r.cgImage else {
            XCTFail("could not render \(name)")
            return nil
        }
        let url = SnapshotOut.dir.appendingPathComponent("\(name).png")
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            XCTFail("could not write \(name)")
            return nil
        }
        CGImageDestinationAddImage(dest, cg, nil)
        CGImageDestinationFinalize(dest)
        return Rendered(name: name, image: cg, scale: scale)
    }

    /// A contact sheet: every image of a set in a grid with its name, for review.
    static func sheet(_ name: String, _ images: [Rendered], columns: Int, cell: CGSize) {
        guard !images.isEmpty else { return }
        let rows = Int(ceil(Double(images.count) / Double(columns)))
        let width = CGFloat(columns) * (cell.width + 16) + 16
        let height = CGFloat(rows) * (cell.height + 36) + 16
        write("_sheet-\(name)", size: CGSize(width: width, height: height), scale: 2) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(0..<rows, id: \.self) { r in
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(0..<columns, id: \.self) { c in
                            let k = r * columns + c
                            if k < images.count {
                                VStack(alignment: .leading, spacing: 4) {
                                    Image(decorative: images[k].image, scale: images[k].scale)
                                        .resizable()
                                        .aspectRatio(contentMode: .fit)
                                        .frame(width: cell.width, height: cell.height, alignment: .topLeading)
                                    Text(images[k].name)
                                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                                        .foregroundStyle(.white.opacity(0.7))
                                        .lineLimit(1)
                                        .frame(width: cell.width, alignment: .leading)
                                }
                            } else {
                                Color.clear.frame(width: cell.width, height: cell.height + 20)
                            }
                        }
                    }
                    .padding(.top, 16)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(white: 0.16))
        }
    }
}

/// Sample snapshots for each state, built from the fixture the web layer wrote.
enum Samples {
    static let cal = Calendar.current

    static func fixture() -> Snapshot {
        var u = URL(fileURLWithPath: #filePath)
        u.deleteLastPathComponent()
        u.deleteLastPathComponent()
        u.appendPathComponent("PepitoCoreTests/Fixtures/snapshot.json")
        // swiftlint:disable:next force_try
        return try! Snapshot.decode(Data(contentsOf: u))
    }

    static func at(_ h: Int, _ m: Int = 0, day: Int = 20) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m))!
    }

    static func idle(_ s: Snapshot) -> Snapshot { var x = s; x.sauna.active = nil; return x }

    /// The PM slot: Reta 3 mg, 30 units, due.
    static var typical: (Snapshot, Date) { (idle(fixture()), at(15)) }
    /// The AM slot: a draw-together group, Semax logged, fish oil due.
    static var group: (Snapshot, Date) { (idle(fixture()), at(8)) }

    static func item(_ id: String, _ name: String, dose: String, units: String?, kind: Snapshot.Kind = .peptide,
                     slot: Snapshot.Slot = .am, status: Snapshot.Status = .due) -> Snapshot.Item {
        let line = [units == nil ? "\(name) \(dose)" : "\(name) \(dose)", units].compactMap { $0 }.joined(separator: ", ")
        return Snapshot.Item(id: "2026-10-20:\(kind.rawValue):\(id)", refId: id, kind: kind, name: name, compound: name, dose: dose,
                             units: units, line: line, form: kind == .peptide ? "injection" : "capsule", slot: slot, status: status,
                             groupId: nil, verb: kind == .peptide ? "Log" : "Take", speech: "\(kind == .peptide ? "Log" : "Take") \(name) \(dose)",
                             canPush: false)
    }

    /// The AM slot with more than fits: long names and six rows.
    static var overflow: (Snapshot, Date) {
        var s = idle(fixture())
        s.days[0].items.insert(contentsOf: [
            item("ipa", "Ipamorelin", dose: "300 mcg", units: "15 units"),
            item("cjc", "CJC-1295 without DAC", dose: "100 mcg", units: "5 units"),
            item("ghk", "GHK-Cu", dose: "1.5 mg", units: "15 units"),
            item("mag", "Magnesium glycinate", dose: "2 capsules", units: nil, kind: .supplement),
        ], at: 0)
        return (s, at(8))
    }

    static var allLogged: (Snapshot, Date) {
        var s = idle(fixture())
        for i in s.days[0].items.indices { s.days[0].items[i].status = .logged }
        return (s, at(21))
    }

    /// The AM slot part-way: the group ticked on the Watch, fish oil still due.
    static var partway: (Snapshot, Date) {
        var s = idle(fixture())
        for i in s.days[0].items.indices where s.days[0].items[i].groupId != nil { s.days[0].items[i].status = .logged }
        return (s, at(8))
    }

    static var paused: (Snapshot, Date) {
        var s = idle(fixture())
        s.paused = .init(active: true, reason: "Holiday", until: "2026-10-27", wholeProtocol: true)
        for d in s.days.indices { s.days[d].items = []; s.days[d].groups = [] }
        s.next = nil
        return (s, at(8))
    }

    /// A sauna session running for 12 min 34 s of 20, at 80°.
    static func running(minutes: Double = 12.57, target: Int = 20) -> Snapshot {
        var s = fixture()
        s.sauna.active = .init(startedAt: (Date().timeIntervalSince1970 - minutes * 60) * 1000, targetMin: target,
                               tempC: 80, rounds: 2, source: "watch")
        return s
    }

    static func readiness(_ score: Int?, band: String?, label: String?, status: String = "ok") -> Snapshot.Readiness? {
        var r = fixture().readiness
        r?.score = score
        r?.band = band
        r?.bandLabel = label
        r?.status = status
        return r
    }

    /// A heart-rate trace for the sauna: a slow climb with some wobble.
    static func heartTrace(minutes: Double, from start: Date, startBPM: Double = 92, endBPM: Double = 136) -> [SaunaHeartRate.Sample] {
        let n = Int(minutes * 12)
        return (0...n).map { k in
            let f = Double(k) / Double(max(1, n))
            let wobble = sin(Double(k) / 3) * 2.5 + sin(Double(k) / 11) * 4
            return .init(t: start.timeIntervalSince1970 + Double(k) * 5, bpm: startBPM + (endBPM - startBPM) * f + wobble)
        }
    }
}
#endif
