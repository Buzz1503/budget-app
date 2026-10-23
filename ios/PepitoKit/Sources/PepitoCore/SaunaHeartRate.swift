import Foundation

/// Heart rate during a sauna session: what the Watch shows live, the summary
/// screen after Stop, and what is sent to the phone. Zones use the same rule
/// as zoneMinutes in src/health/engine/training.ts, with the floors and max
/// heart rate from the snapshot.
public enum SaunaHeartRate {
    /// The longest gap between two samples still counted as time in a zone.
    public static let maxSampleGapSec: Double = 120
    /// Samples sent to the phone are one every 5 seconds.
    public static let resolutionSec: Double = 5

    public struct Sample: Equatable, Sendable {
        public var t: Double   // epoch seconds
        public var bpm: Double
        public init(t: Double, bpm: Double) { self.t = t; self.bpm = bpm }
    }

    /// Where a heart rate sits on a smooth 0 to 5 scale: 1.0 at the zone 1
    /// floor, 1.5 halfway to zone 2, 5.0 at and above the zone 5 floor. Drives
    /// the colour of the running ring, which moves with the heart rate rather
    /// than jumping at each zone edge.
    public static func zonePosition(bpm: Double, maxHR: Int, floors: [Double]) -> Double {
        guard maxHR > 0, let first = floors.first else { return 0 }
        let frac = bpm / Double(maxHR)
        if frac < first { return max(0, frac / first) }
        for k in 0..<(floors.count - 1) where frac < floors[k + 1] {
            return Double(k + 1) + (frac - floors[k]) / (floors[k + 1] - floors[k])
        }
        return Double(floors.count)
    }

    /// Zone 1 to 5 for a heart rate (0 below zone 1).
    public static func zone(bpm: Double, maxHR: Int, floors: [Double]) -> Int {
        guard maxHR > 0 else { return 0 }
        let frac = bpm / Double(maxHR)
        var z = 0
        for (k, f) in floors.enumerated() where frac >= f { z = k + 1 }
        return z
    }

    /// Minutes in zones 1 to 5, each sample counting until the next (at most two minutes).
    public static func zoneMinutes(_ samples: [Sample], maxHR: Int, floors: [Double]) -> [Double] {
        var zones = Array(repeating: 0.0, count: max(floors.count, 5))
        let s = samples.sorted { $0.t < $1.t }
        for i in s.indices {
            guard i + 1 < s.count else { break }
            let dt = min(s[i + 1].t - s[i].t, maxSampleGapSec)
            guard dt > 0 else { continue }
            let z = zone(bpm: s[i].bpm, maxHR: maxHR, floors: floors)
            if z > 0 { zones[z - 1] += dt / 60 }
        }
        return zones.map { ($0 * 10).rounded() / 10 }
    }

    /// One value every 5 seconds: the last sample at or before each tick.
    public static func resample(_ samples: [Sample], from start: Double, to end: Double, every step: Double = resolutionSec) -> [Sample] {
        let s = samples.sorted { $0.t < $1.t }
        guard !s.isEmpty, end > start else { return [] }
        var out: [Sample] = []
        var j = 0
        var last: Double? = nil
        var t = start
        while t <= end {
            while j < s.count && s[j].t <= t { last = s[j].bpm; j += 1 }
            if let b = last { out.append(Sample(t: t, bpm: b)) }
            t += step
        }
        return out
    }

    /// Fewer than one sample a minute over the session: shown as sparse.
    public static func isSparse(_ samples: [Sample], start: Double, end: Double) -> Bool {
        let minutes = (end - start) / 60
        guard minutes > 0 else { return true }
        return Double(samples.count) < minutes
    }

    public struct Summary: Equatable, Sendable {
        public var durationSec: Double
        public var avg: Int?
        public var peak: Int?
        public var zoneMinutes: [Double]
        public var sparse: Bool
    }

    public static func summary(_ samples: [Sample], start: Double, end: Double, maxHR: Int, floors: [Double]) -> Summary {
        let inWindow = samples.filter { $0.t >= start && $0.t <= end }
        let bpms = inWindow.map(\.bpm)
        return Summary(
            durationSec: max(0, end - start),
            avg: bpms.isEmpty ? nil : Int((bpms.reduce(0, +) / Double(bpms.count)).rounded()),
            peak: bpms.max().map { Int($0.rounded()) },
            zoneMinutes: zoneMinutes(inWindow, maxHR: maxHR, floors: floors),
            sparse: isSparse(inWindow, start: start, end: end))
    }

    // MARK: cool-down

    /// How long the optional cool-down after Stop records heart rate.
    public static let coolDownSec: Double = 300
    /// A mark's reading is the sample nearest to it, if one is within this many seconds.
    public static let coolDownTolSec: Double = 20

    public struct CoolDownDrop: Equatable, Sendable {
        public var exitHR: Int
        /// bpm lower 2 and 5 minutes after leaving; nil until there is a reading then
        public var drop2: Int?
        public var drop5: Int?
    }

    /// Heart rate drop 2 and 5 minutes after leaving the sauna, the same rule
    /// as coolDownDrop in src/sauna/analytics.ts.
    public static func coolDownDrop(_ samples: [Sample], exit: Double) -> CoolDownDrop? {
        func at(_ t: Double) -> Double? {
            samples.filter { abs($0.t - t) <= coolDownTolSec }.min { abs($0.t - t) < abs($1.t - t) }?.bpm
        }
        guard let e = at(exit) else { return nil }
        let drop = { (sec: Double) in at(exit + sec).map { Int((e - $0).rounded()) } }
        return CoolDownDrop(exitHR: Int(e.rounded()), drop2: drop(120), drop5: drop(300))
    }

    /// The 5-minute marks passed between two moments, for the haptic taps.
    public static func fiveMinuteMarks(elapsedFrom a: Double, to b: Double) -> [Int] {
        guard b > a else { return [] }
        let first = Int((a / 300).rounded(.down)) + 1
        let last = Int((b / 300).rounded(.down))
        return first <= last ? Array(first...last).map { $0 * 5 } : []
    }
}
