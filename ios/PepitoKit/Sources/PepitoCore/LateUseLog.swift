import Foundation

/// The late phone use the Screen Time monitor writes and the app reads: the
/// highest threshold reached each night, by the evening's date.
public enum LateUseLog {
    public static let file = "late-use.json"

    /// The evening a moment belongs to: before noon is the evening before.
    public static func night(of date: Date, calendar: Calendar = .current) -> String {
        let d = calendar.component(.hour, from: date) < 12 ? calendar.date(byAdding: .day, value: -1, to: date)! : date
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// "m15" -> 15
    public static func minutes(event: String) -> Int? { event.hasPrefix("m") ? Int(event.dropFirst()) : nil }

    /// Record a threshold: the night keeps the highest; only the last 60 nights are kept.
    public static func record(_ log: [String: Int], night: String, minutes: Int) -> [String: Int] {
        var out = log
        out[night] = max(out[night] ?? 0, minutes)
        let keep = out.keys.sorted().suffix(60)
        return out.filter { keep.contains($0.key) }
    }
}
