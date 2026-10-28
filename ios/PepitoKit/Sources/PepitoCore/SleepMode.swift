import Foundation

/// Watch sleep mode: one tap at bedtime on the Watch (the Home tile, the Pepito
/// sleep complication, Siri or a Shortcut) saves the lights-out time, makes
/// sure the movement recording covers the next 10 hours, asks the iPhone to
/// start Sleep sounds, and shows a dark night screen. "I'm up" in the morning
/// saves the get-up time, stops Sleep sounds on the iPhone and shows one
/// screen of last night once Health has it.
///
/// No workout session and no continuous sensors: the night screen redraws at
/// most once a minute, and the heart rate it shows is the latest sample
/// Health already has. The system Sleep Focus screen takes over on wrist drop.
public enum SleepMode {

    /// One night as the Watch saw it: when the lights went out, and when you got up.
    public struct Night: Codable, Equatable, Sendable {
        public var lightsOut: Date
        public var upAt: Date?
        public init(lightsOut: Date, upAt: Date? = nil) { self.lightsOut = lightsOut; self.upAt = upAt }
    }

    public static let defaultsKey = "pepito.sleepmode.night"
    /// A lights-out older than this without "I'm up" is a night that was never closed.
    public static let maxNightH = 14.0
    /// The movement recording must reach this far past lights out.
    public static let coverH = 10.0
    public static let eveningHour = 18
    public static let morningHour = 4
    public static let dayHour = 12

    public static func load(_ defaults: UserDefaults) -> Night? {
        defaults.data(forKey: defaultsKey).flatMap { try? JSONDecoder().decode(Night.self, from: $0) }
    }

    public static func save(_ night: Night?, to defaults: UserDefaults) {
        if let night, let d = try? JSONEncoder().encode(night) { defaults.set(d, forKey: defaultsKey) } else { defaults.removeObject(forKey: defaultsKey) }
    }

    // MARK: - where we are in the day

    public enum Phase: Equatable, Sendable {
        /// 6 pm to 4 am, not asleep yet: "Start sleep"
        case evening
        /// lights out, no "I'm up" yet
        case sleeping(since: Date)
        /// 4 am to noon: last night
        case morning
        /// noon to 6 pm: last night, quietly
        case day
    }

    public static func isSleeping(_ night: Night?, now: Date) -> Bool {
        guard let n = night, n.upAt == nil else { return false }
        let age = now.timeIntervalSince(n.lightsOut)
        return age >= 0 && age < maxNightH * 3600
    }

    public static func phase(now: Date, night: Night?, calendar: Calendar = .current) -> Phase {
        if isSleeping(night, now: now), let n = night { return .sleeping(since: n.lightsOut) }
        let h = calendar.component(.hour, from: now)
        if h >= eveningHour || h < morningHour { return .evening }
        return h < dayHour ? .morning : .day
    }

    /// The next moment the phase can change by the clock alone (4 am, noon, 6 pm), for timelines.
    public static func nextChange(after now: Date, calendar: Calendar = .current) -> Date {
        let candidates = [morningHour, dayHour, eveningHour].compactMap { h -> Date? in
            calendar.nextDate(after: now, matching: DateComponents(hour: h, minute: 0), matchingPolicy: .nextTime)
        }
        return candidates.min() ?? now.addingTimeInterval(3600)
    }

    // MARK: - words

    /// "6 h 48 m"
    public static func duration(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        return h > 0 ? "\(h) h \(m) m" : "\(m) m"
    }

    /// The Home tile's line: "Start sleep" in the evening, "Sleeping · 1 h 20 m" at night, "Last night 6 h 48 m" by day.
    public static func tileLine(phase: Phase, lastNight: Snapshot.LastNight?, now: Date) -> WatchHome.Line {
        switch phase {
        case .evening:
            return WatchHome.Line(text: "Start sleep", done: false)
        case .sleeping(let since):
            let mins = max(0, Int(now.timeIntervalSince(since) / 60))
            return WatchHome.Line(text: "Sleeping · \(duration(mins))", done: false, short: "Sleeping")
        case .morning, .day:
            guard let n = lastNight?.asleepMin else { return WatchHome.Line(text: "No night yet", done: false, short: "No night") }
            return WatchHome.Line(text: "Last night \(duration(n))", done: false, short: duration(n))
        }
    }

    /// "1 h 20 m since lights out"
    public static func sinceLightsOut(_ since: Date, now: Date) -> String {
        "\(duration(max(0, Int(now.timeIntervalSince(since) / 60)))) since lights out"
    }

    // MARK: - the complication

    public enum Complication: Equatable, Sendable {
        /// evening: a moon, tap to start
        case start
        /// asleep: a moon and the time since lights out
        case sleeping(since: Date)
        /// morning and day: last night's sleep score
        case score(Int)
        /// morning and day without a score: the hours
        case hours(Int)
        case empty
    }

    public static func complication(now: Date, night: Night?, lastNight: Snapshot.LastNight?, calendar: Calendar = .current) -> Complication {
        switch phase(now: now, night: night, calendar: calendar) {
        case .evening: return .start
        case .sleeping(let since): return .sleeping(since: since)
        case .morning, .day:
            if let s = lastNight?.score { return .score(s) }
            if let m = lastNight?.asleepMin { return .hours(m) }
            return .empty
        }
    }

    // MARK: - the movement recording

    /// Whether a new recording is needed so movement is covered for the next 10 hours.
    /// The recorder keeps one request of `durationH`; a newer request replaces it.
    public static func recordingNeeded(now: Date, lastStart: Date?, durationH: Double = RestlessRecording.durationH, coverH: Double = coverH) -> Bool {
        guard let s = lastStart, s <= now else { return true }
        return s.addingTimeInterval(durationH * 3600) < now.addingTimeInterval(coverH * 3600)
    }

    // MARK: - the message to the iPhone

    public enum Command: String, Sendable { case start, up }

    public static let messageKey = "sleepMode"

    /// What the Watch sends: a message when the iPhone is reachable, the same as queued user info otherwise.
    public static func message(_ command: Command, at: Date) -> [String: Any] {
        [messageKey: command.rawValue, "at": at.timeIntervalSince1970]
    }

    public static func command(from info: [String: Any]) -> (command: Command, at: Date)? {
        guard let raw = info[messageKey] as? String, let c = Command(rawValue: raw) else { return nil }
        let at = (info["at"] as? Double).map { Date(timeIntervalSince1970: $0) } ?? Date()
        return (c, at)
    }

    /// How the iPhone starts Sleep sounds for the Watch: by "watch", so a start that
    /// iOS blocks from the background leaves the time-sensitive "Tap to start Sleep sounds".
    public static let startedBy = "watch"

    /// The action queued for the web layer, which keeps the times for the Sleep tab.
    public static func action(_ command: Command, at: Date) -> PendingAction {
        PendingAction(type: .sleepMode, at: at, source: .watch,
                      payload: .init(kind: command == .start ? "lightsOut" : "up", start: at.timeIntervalSince1970 * 1000))
    }

    // MARK: - the morning

    /// The morning screen's numbers, once Health has the night that ended after lights out.
    public struct Morning: Equatable, Sendable {
        public var asleepMin: Int
        public var score: Int?
        public var readiness: Int?
        public var restless: Int?
        public var snoringMin: Int?
        public init(asleepMin: Int, score: Int? = nil, readiness: Int? = nil, restless: Int? = nil, snoringMin: Int? = nil) {
            self.asleepMin = asleepMin; self.score = score; self.readiness = readiness; self.restless = restless; self.snoringMin = snoringMin
        }
    }

    /// Last night's summary when the snapshot's last night is the one that began with this lights-out;
    /// nil while Health has not synced it yet ("Waiting for Health").
    public static func morning(lastNight: Snapshot.LastNight?, night: Night?, calendar: Calendar = .current) -> Morning? {
        guard let l = lastNight, let asleep = l.asleepMin else { return nil }
        if let n = night {
            // the night's wake date: the day after an evening lights-out, the same day after midnight
            let h = calendar.component(.hour, from: n.lightsOut)
            let wake = h >= dayHour ? calendar.date(byAdding: .day, value: 1, to: n.lightsOut) ?? n.lightsOut : n.lightsOut
            guard l.date == DoseBoard.dateString(wake, calendar: calendar) else { return nil }
        }
        return Morning(asleepMin: asleep, score: l.score, readiness: l.readiness, restless: l.restless, snoringMin: l.snoringMin)
    }
}
