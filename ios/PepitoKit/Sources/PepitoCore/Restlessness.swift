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
