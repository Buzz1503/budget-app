import Foundation
import Capacitor
import HealthKit

/**
 * PepitoHealth: the Apple Health reads the general-purpose plugin
 * (@capgo/capacitor-health) does not cover, and the one authorization request
 * for everything the app reads.
 *
 * Reads, and one write: water you log with a sauna session (dietary water).
 * Nothing else is written to Health, and nothing here makes a network call. A type the device does not support, or one the user declined, comes
 * back as an empty result, never as an error: HealthKit does not reveal
 * whether read access was refused, so "no data" is the only honest answer.
 */
@objc(PepitoHealthPlugin)
public class PepitoHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoHealthPlugin"
    public let jsName = "PepitoHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCharacteristics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readQuantitySamples", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dailySum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "daytimeAverage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeWater", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    // MARK: - availability and authorization

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// Everything the app reads, in one system sheet.
    private func readTypes() -> Set<HKObjectType> {
        var ids: [HKQuantityTypeIdentifier] = [
            .restingHeartRate, .heartRate, .heartRateVariabilitySDNN, .respiratoryRate,
            .oxygenSaturation, .vo2Max, .stepCount, .activeEnergyBurned,
            .bodyMass, .bodyFatPercentage, .leanBodyMass,
            .bloodPressureSystolic, .bloodPressureDiastolic,
            .dietaryEnergyConsumed, .dietaryProtein, .dietaryWater, .headphoneAudioExposure
        ]
        if #available(iOS 16.0, *) {
            ids.append(.appleSleepingWristTemperature)
            ids.append(.heartRateRecoveryOneMinute)
        }
        if #available(iOS 17.0, *) {
            ids.append(.timeInDaylight)
        }
        if #available(iOS 18.0, *) {
            ids.append(.appleSleepingBreathingDisturbances)
        }
        var types = Set<HKObjectType>()
        for id in ids {
            if let type = HKObjectType.quantityType(forIdentifier: id) {
                types.insert(type)
            }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleep)
        }
        types.insert(HKObjectType.workoutType())
        if let dob = HKObjectType.characteristicType(forIdentifier: .dateOfBirth) {
            types.insert(dob)
        }
        if let sex = HKObjectType.characteristicType(forIdentifier: .biologicalSex) {
            types.insert(sex)
        }
        return types
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["requested": false])
            return
        }
        // the one type written: water logged with a sauna session
        var share = Set<HKSampleType>()
        if let water = HKObjectType.quantityType(forIdentifier: .dietaryWater) { share.insert(water) }
        store.requestAuthorization(toShare: share, read: readTypes()) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["requested": success])
        }
    }

    // MARK: - characteristics

    @objc func getCharacteristics(_ call: CAPPluginCall) {
        var result: [String: Any] = [:]
        if let comps = try? store.dateOfBirthComponents(),
           let year = comps.year, let month = comps.month, let day = comps.day {
            result["dateOfBirth"] = String(format: "%04d-%02d-%02d", year, month, day)
        }
        if let sexObject = try? store.biologicalSex() {
            switch sexObject.biologicalSex {
            case .female:
                result["biologicalSex"] = "female"
            case .male:
                result["biologicalSex"] = "male"
            case .other:
                result["biologicalSex"] = "other"
            default:
                break
            }
        }
        call.resolve(result)
    }

    // MARK: - quantities

    /// The types this plugin reads itself, with the unit each value is returned in.
    private func quantitySpec(_ name: String) -> (HKQuantityType, HKUnit)? {
        switch name {
        case "leanBodyMass":
            if let type = HKObjectType.quantityType(forIdentifier: .leanBodyMass) {
                return (type, HKUnit.gramUnit(with: .kilo))
            }
        case "dietaryProtein":
            if let type = HKObjectType.quantityType(forIdentifier: .dietaryProtein) {
                return (type, HKUnit.gram())
            }
        case "heartRateRecoveryOneMinute":
            if #available(iOS 16.0, *) {
                if let type = HKObjectType.quantityType(forIdentifier: .heartRateRecoveryOneMinute) {
                    return (type, HKUnit.count().unitDivided(by: HKUnit.minute()))
                }
            }
        case "timeInDaylight":
            if #available(iOS 17.0, *) {
                if let type = HKObjectType.quantityType(forIdentifier: .timeInDaylight) {
                    return (type, HKUnit.minute())
                }
            }
        case "appleSleepingBreathingDisturbances":
            if #available(iOS 18.0, *) {
                if let type = HKObjectType.quantityType(forIdentifier: .appleSleepingBreathingDisturbances) {
                    return (type, HKUnit.count())
                }
            }
        case "headphoneAudioExposure":
            if let type = HKObjectType.quantityType(forIdentifier: .headphoneAudioExposure) {
                return (type, HKUnit.decibelAWeightedSoundPressureLevel())
            }
        case "heartRate":
            if let type = HKObjectType.quantityType(forIdentifier: .heartRate) {
                return (type, HKUnit.count().unitDivided(by: HKUnit.minute()))
            }
        default:
            break
        }
        return nil
    }

    /// Every sample of one type in a window, oldest first, with its source.
    @objc func readQuantitySamples(_ call: CAPPluginCall) {
        guard let name = call.getString("type"), let spec = quantitySpec(name) else {
            call.resolve(["samples": [[String: Any]]()])
            return
        }
        let start = parseDate(call.getString("startDate")) ?? Date(timeIntervalSinceNow: -86400)
        let end = parseDate(call.getString("endDate")) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let unit = spec.1
        let query = HKSampleQuery(sampleType: spec.0, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if error != nil {
                call.resolve(["samples": [[String: Any]]()])
                return
            }
            var out: [[String: Any]] = []
            for sample in samples ?? [] {
                guard let quantitySample = sample as? HKQuantitySample else { continue }
                var row: [String: Any] = [:]
                row["value"] = quantitySample.quantity.doubleValue(for: unit)
                row["startDate"] = PepitoHealthPlugin.isoString(quantitySample.startDate)
                row["endDate"] = PepitoHealthPlugin.isoString(quantitySample.endDate)
                row["sourceName"] = quantitySample.sourceRevision.source.name
                row["sourceId"] = quantitySample.sourceRevision.source.bundleIdentifier
                row["uuid"] = quantitySample.uuid.uuidString
                // metadata as plain strings (Apple's own call on breathing disturbances, when present)
                if let meta = quantitySample.metadata, !meta.isEmpty {
                    var m: [String: String] = [:]
                    for (k, v) in meta { m[k] = "\(v)" }
                    row["metadata"] = m
                }
                out.append(row)
            }
            call.resolve(["samples": out])
        }
        store.execute(query)
    }

    /// A cumulative type summed per local calendar day. A statistics query merges
    /// overlapping sources itself, so a phone and a watch are never counted twice.
    @objc func dailySum(_ call: CAPPluginCall) {
        guard let name = call.getString("type"), let spec = quantitySpec(name) else {
            call.resolve(["samples": [[String: Any]]()])
            return
        }
        let start = parseDate(call.getString("startDate")) ?? Date(timeIntervalSinceNow: -86400)
        let end = parseDate(call.getString("endDate")) ?? Date()
        let anchor = Calendar.current.startOfDay(for: start)
        var interval = DateComponents()
        interval.day = 1
        let predicate = HKQuery.predicateForSamples(withStart: anchor, end: end, options: [])
        let unit = spec.1
        let query = HKStatisticsCollectionQuery(
            quantityType: spec.0,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum,
            anchorDate: anchor,
            intervalComponents: interval
        )
        query.initialResultsHandler = { _, results, error in
            guard error == nil, let results = results else {
                call.resolve(["samples": [[String: Any]]()])
                return
            }
            var out: [[String: Any]] = []
            results.enumerateStatistics(from: anchor, to: end) { statistics, _ in
                if let sum = statistics.sumQuantity() {
                    var row: [String: Any] = [:]
                    row["date"] = PepitoHealthPlugin.dayString(statistics.startDate)
                    row["value"] = sum.doubleValue(for: unit)
                    out.append(row)
                }
            }
            call.resolve(["samples": out])
        }
        store.execute(query)
    }

    /// The average of a discrete type between two hours of each local day (heart rate 9 am to 9 pm).
    @objc func daytimeAverage(_ call: CAPPluginCall) {
        guard let name = call.getString("type"), let spec = quantitySpec(name) else {
            call.resolve(["samples": [[String: Any]]()])
            return
        }
        let start = parseDate(call.getString("startDate")) ?? Date(timeIntervalSinceNow: -86400)
        let end = parseDate(call.getString("endDate")) ?? Date()
        let fromHour = call.getInt("fromHour") ?? 9
        let toHour = call.getInt("toHour") ?? 21
        let calendar = Calendar.current
        var day = calendar.startOfDay(for: start)
        var windows: [(Date, Date)] = []
        while day < end {
            if let a = calendar.date(bySettingHour: fromHour, minute: 0, second: 0, of: day),
               let b = calendar.date(bySettingHour: toHour, minute: 0, second: 0, of: day), a < end {
                windows.append((a, min(b, end)))
            }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        let unit = spec.1
        let group = DispatchGroup()
        let lock = NSLock()
        var out: [[String: Any]] = []
        for (a, b) in windows where b > a {
            group.enter()
            let predicate = HKQuery.predicateForSamples(withStart: a, end: b, options: [])
            let query = HKStatisticsQuery(quantityType: spec.0, quantitySamplePredicate: predicate, options: .discreteAverage) { _, stats, _ in
                if let avg = stats?.averageQuantity() {
                    lock.lock()
                    out.append(["date": PepitoHealthPlugin.dayString(a), "value": avg.doubleValue(for: unit)])
                    lock.unlock()
                }
                group.leave()
            }
            store.execute(query)
        }
        group.notify(queue: .main) {
            call.resolve(["samples": out.sorted { ($0["date"] as? String ?? "") < ($1["date"] as? String ?? "") }])
        }
    }

    /// Water logged with a sauna session, in millilitres, written as dietary water at its time.
    @objc func writeWater(_ call: CAPPluginCall) {
        guard let ml = call.getDouble("ml"), ml > 0, let type = HKObjectType.quantityType(forIdentifier: .dietaryWater) else {
            call.resolve(["saved": false])
            return
        }
        let at = parseDate(call.getString("date")) ?? Date()
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: HKUnit.literUnit(with: .milli), doubleValue: ml), start: at, end: at,
                                      metadata: [HKMetadataKeyExternalUUID: call.getString("id") ?? UUID().uuidString])
        store.save(sample) { ok, _ in call.resolve(["saved": ok]) }
    }

    // MARK: - dates

    private func parseDate(_ value: String?) -> Date? {
        guard let value = value else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }

    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
