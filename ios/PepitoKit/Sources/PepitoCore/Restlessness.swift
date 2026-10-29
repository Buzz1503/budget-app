import Foundation

/// What the Watch sends after a night: movement summarised, never the raw
/// accelerometer. The phone files it under the night it belongs to.
public struct RestlessSummary: Codable, Equatable, Sendable {
    /// the main sleep window it covers, epoch ms
    public var start: Double
    public var end: Double
    public var movementMin: Double
    public var positionChanges: Int
    public var restlessPeriods: Int
    /// restless periods plus position changes per hour asleep
    public var indexPerHour: Double
    /// one value a minute: the share of that minute spent moving, 0 to 1
    public var series: [Double]

    public init(start: Double, end: Double, movementMin: Double, positionChanges: Int, restlessPeriods: Int, indexPerHour: Double, series: [Double]) {
        self.start = start; self.end = end; self.movementMin = movementMin; self.positionChanges = positionChanges
        self.restlessPeriods = restlessPeriods; self.indexPerHour = indexPerHour; self.series = series
    }
}

/// Toss and turn from the wrist accelerometer (CMSensorRecorder, 50 Hz, in g).
///
/// The recording is read once after waking, in order, through `Accumulator`,
/// which keeps one row a second, so a whole night is a few hundred kB however
/// many samples there were. From those rows:
///   - a second is "moving" when the size of the acceleration varies by more
///     than 0.02 g within it (a still wrist varies by a few thousandths);
///   - movement minutes are the moving seconds added up;
///   - a position change is the wrist settling in a new orientation: the
///     average direction of gravity over still half-minutes turns by more than
///     35 degrees and stays turned for a minute (a proxy for rolling over);
///   - a restless period is a 5-minute block with 30 seconds or more of movement;
///   - the index is restless periods plus position changes per hour of the window.
public enum Restlessness {
    public static let movingG = 0.02
    public static let turnDegrees = 35.0
    public static let restlessSecondsPer5Min = 30.0

    public struct Second: Equatable, Sendable {
        public var t: Double      // epoch seconds, start of the second
        public var spread: Double // standard deviation of |a| within the second, g
        public var gx: Double, gy: Double, gz: Double // mean acceleration (gravity, when still)
        public var moving: Bool { spread > Restlessness.movingG }
    }

    /// Reads samples in time order and keeps one row a second.
    public struct Accumulator {
        public private(set) var seconds: [Second] = []
        private var current: Double = -1
        private var n = 0.0, sum = 0.0, sumSq = 0.0, sx = 0.0, sy = 0.0, sz = 0.0

        public init() {}

        public mutating func add(t: Double, x: Double, y: Double, z: Double) {
            let sec = t.rounded(.down)
            if sec != current { flush(); current = sec }
            let mag = (x * x + y * y + z * z).squareRoot()
            n += 1; sum += mag; sumSq += mag * mag; sx += x; sy += y; sz += z
        }

        public mutating func finish() -> [Second] { flush(); return seconds }

        private mutating func flush() {
            guard n > 0, current >= 0 else { n = 0; return }
            let m = sum / n
            let variance = max(0, sumSq / n - m * m)
            seconds.append(Second(t: current, spread: variance.squareRoot(), gx: sx / n, gy: sy / n, gz: sz / n))
            n = 0; sum = 0; sumSq = 0; sx = 0; sy = 0; sz = 0
        }
    }

    /// The share of each minute spent moving, from `start` to `end` (epoch seconds).
    public static func minuteSeries(_ seconds: [Second], start: Double, end: Double) -> [Double] {
        let count = max(0, Int(((end - start) / 60).rounded(.up)))
        var moving = Array(repeating: 0.0, count: count)
        var seen = Array(repeating: 0.0, count: count)
        for s in seconds where s.t >= start && s.t < end {
            let i = Int((s.t - start) / 60)
            guard i < count else { continue }
            seen[i] += 1
            if s.moving { moving[i] += 1 }
        }
        return (0..<count).map { seen[$0] > 0 ? (moving[$0] / seen[$0] * 100).rounded() / 100 : 0 }
    }

    /// Settled orientations, one per still half-minute, and how often they turn by more than 35 degrees for a minute or more.
    public static func positionChanges(_ seconds: [Second], start: Double, end: Double) -> Int {
        // the mean gravity direction of each half-minute that is mostly still
        var windows: [(t: Double, v: (Double, Double, Double))] = []
        var bucket: [Second] = []
        var bucketStart = start
        func close() {
            let still = bucket.filter { !$0.moving }
            if bucket.count >= 10, Double(still.count) >= Double(bucket.count) * 0.8 {
                let x = still.map(\.gx).reduce(0, +), y = still.map(\.gy).reduce(0, +), z = still.map(\.gz).reduce(0, +)
                let len = (x * x + y * y + z * z).squareRoot()
                if len > 0 { windows.append((bucketStart, (x / len, y / len, z / len))) }
            }
            bucket = []
        }
        for s in seconds where s.t >= start && s.t < end {
            if s.t >= bucketStart + 30 { close(); bucketStart += 30 * ((s.t - bucketStart) / 30).rounded(.down) }
            bucket.append(s)
        }
        close()
        guard var settled = windows.first?.v else { return 0 }
        var changes = 0
        var i = 1
        while i < windows.count {
            let v = windows[i].v
            if angle(settled, v) > turnDegrees {
                // the new orientation has to hold for the next half-minute too
                if i + 1 < windows.count, angle(v, windows[i + 1].v) <= turnDegrees {
                    changes += 1
                    settled = v
                    i += 2
                    continue
                }
            }
            i += 1
        }
        return changes
    }

    static func angle(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
        let dot = max(-1, min(1, a.0 * b.0 + a.1 * b.1 + a.2 * b.2))
        return acos(dot) * 180 / .pi
    }

    /// 5-minute blocks with 30 seconds or more of movement.
    public static func restlessPeriods(_ minutes: [Double]) -> Int {
        stride(from: 0, to: minutes.count, by: 5).filter { i in
            minutes[i..<min(i + 5, minutes.count)].reduce(0, +) * 60 >= restlessSecondsPer5Min
        }.count
    }

    /// The night's summary for the main sleep window (epoch seconds).
    public static func summary(_ seconds: [Second], start: Double, end: Double) -> RestlessSummary {
        let series = minuteSeries(seconds, start: start, end: end)
        let movingSeconds = Double(seconds.filter { $0.t >= start && $0.t < end && $0.moving }.count)
        let changes = positionChanges(seconds, start: start, end: end)
        let periods = restlessPeriods(series)
        let hours = max(0.5, (end - start) / 3600)
        return RestlessSummary(start: start * 1000, end: end * 1000,
                               movementMin: (movingSeconds / 60 * 10).rounded() / 10,
                               positionChanges: changes, restlessPeriods: periods,
                               indexPerHour: (Double(periods + changes) / hours * 10).rounded() / 10,
                               series: series)
    }
}

/// When the overnight recording is (re)started: each evening after 6 pm, when
/// there is no recording that still runs past the next morning.
public enum RestlessRecording {
    public static let durationH = 12.0
    public static let fromHour = 18

    public static func shouldStart(now: Date, lastStart: Date?, enabled: Bool, calendar: Calendar = .current) -> Bool {
        guard enabled, calendar.component(.hour, from: now) >= fromHour else { return false }
        guard let last = lastStart else { return true }
        // a recording started this evening is still running
        return now.timeIntervalSince(last) > 10 * 3600
    }

    /// The next background refresh to ask for: 6:05 pm to start the evening's
    /// recording, hourly through the evening as a backup, then 6:30 am and
    /// every two hours in the morning to summarise the night.
    public static func nextRefresh(after now: Date, calendar: Calendar = .current) -> Date {
        let h = calendar.component(.hour, from: now)
        func at(_ hour: Int, _ minute: Int, dayOffset: Int = 0) -> Date {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: calendar.startOfDay(for: now))!
            return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)!
        }
        if h < 6 { return at(6, 30) }
        if h < 12 { return now.addingTimeInterval(2 * 3600) }
        if h < 18 { return at(18, 5) }
        if h < 23 { return now.addingTimeInterval(3600) }
        return at(6, 30, dayOffset: 1)
    }

    // MARK: - asking for a fresh window

    /// What asked for a fresh 12 hour recording. CMSensorRecorder records only for the
    /// window requested, so every one of these asks again from now.
    public enum Trigger: String, Codable, Sendable, CaseIterable {
        /// the Watch app launched, came to the front or ran a background refresh
        case appRun
        /// a new snapshot arrived from the iPhone
        case snapshot
        /// Sleep sounds started on the iPhone
        case soundsStarted
        /// the 9 pm Sleep sounds schedule fired on the iPhone
        case schedule
        /// Start sleep on the Watch
        case startSleep
        /// a Pepito complication refreshing (backup, only with motion access already given)
        case complication
    }

    /// A request within this many minutes of the last is skipped (the window it asked for
    /// still has almost all of its 12 hours), except Start sleep, which always asks.
    public static let minRequestGapMin = 10.0

    public static func shouldRequest(trigger: Trigger, now: Date, lastStart: Date?, enabled: Bool) -> Bool {
        guard enabled else { return false }
        if trigger == .startSleep { return true }
        guard let last = lastStart, last <= now else { return true }
        return now.timeIntervalSince(last) >= minRequestGapMin * 60
    }

    /// The iPhone's message to the Watch: ask for a fresh window now.
    public static let messageKey = "restlessStart"

    public static func message(_ trigger: Trigger, at: Date) -> [String: Any] {
        [messageKey: trigger.rawValue, "at": at.timeIntervalSince1970]
    }

    public static func trigger(from info: [String: Any]) -> Trigger? {
        (info[messageKey] as? String).flatMap(Trigger.init(rawValue:))
    }

    // MARK: - which nights to read

    /// CMSensorRecorder keeps three days; a night older than this cannot be read any more.
    public static let keepDays = 3.0
    /// The recorder needs a few minutes before the latest data can be read.
    public static let settleMin = 5.0

    /// Every main sleep of the last three days not yet sent, one per wake date (the
    /// longest run that ends on that date), oldest first. A morning without the Watch
    /// app running no longer loses its night: the next run reads it.
    public static func nightsToSend(_ samples: [(start: Date, end: Date)], sent: Set<String>, now: Date, calendar: Calendar = .current) -> [(wake: String, start: Date, end: Date)] {
        let sorted = samples.sorted { $0.start < $1.start }
        var runs: [(Date, Date)] = []
        for s in sorted {
            if let last = runs.last, s.start.timeIntervalSince(last.1) < 3600 {
                runs[runs.count - 1] = (last.0, max(last.1, s.end))
            } else {
                runs.append((s.start, s.end))
            }
        }
        var best: [String: (Date, Date)] = [:]
        for r in runs {
            guard r.1 <= now.addingTimeInterval(-settleMin * 60), r.1 >= now.addingTimeInterval(-keepDays * 86400) else { continue }
            let wake = wakeDate(r.1, calendar: calendar)
            if let b = best[wake], b.1.timeIntervalSince(b.0) >= r.1.timeIntervalSince(r.0) { continue }
            best[wake] = r
        }
        return best.filter { !sent.contains($0.key) }
            .map { (wake: $0.key, start: $0.value.0, end: $0.value.1) }
            .sorted { $0.start < $1.start }
    }

    /// CMSensorRecorder answers at most 12 hours per query: the window in pieces.
    public static func chunks(start: Date, end: Date, maxH: Double = 12) -> [(start: Date, end: Date)] {
        var out: [(start: Date, end: Date)] = []
        var a = start
        while a < end {
            let b = min(end, a.addingTimeInterval(maxH * 3600))
            out.append((a, b))
            a = b
        }
        return out
    }

    /// The wake-up date a summary is filed under (the morning it is made on).
    public static func wakeDate(_ end: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: end)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// The main sleep from the night's asleep samples (start, end): the longest
    /// run with no gap of an hour or more.
    public static func mainSleep(_ samples: [(start: Date, end: Date)]) -> (start: Date, end: Date)? {
        let sorted = samples.sorted { $0.start < $1.start }
        var best: (Date, Date)?
        var cur: (Date, Date)?
        for s in sorted {
            if let c = cur, s.start.timeIntervalSince(c.1) < 3600 {
                cur = (c.0, max(c.1, s.end))
            } else {
                cur = (s.start, s.end)
            }
            if let c = cur, best == nil || c.1.timeIntervalSince(c.0) > best!.1.timeIntervalSince(best!.0) { best = c }
        }
        return best.map { (start: $0.0, end: $0.1) }
    }
}
