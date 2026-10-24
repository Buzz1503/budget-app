import Foundation
import SwiftUI
import FamilyControls
import DeviceActivity
import ManagedSettings
import PepitoCore

/// Late phone use from Screen Time (Family Controls, individual).
///
/// Apple keeps Screen Time data inside its own extensions, so the minutes are
/// counted by the DeviceActivity monitor extension (PepitoLateUse): each night
/// from planned bedtime to wake, thresholds at 5, 10, 15 ... 180 minutes of
/// use of the apps you chose, each one written to the App Group as it is
/// reached. Choose "All apps and categories" and leave out YouTube (and any
/// app you fall asleep listening to), so audio in bed is not counted.
/// Without the entitlement or the authorization, the manual "Screen in bed"
/// stays in the evening sheet.
enum LateUse {
    static let activity = DeviceActivityName("pepito.lateUse")
    static let thresholds = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180]
    private static let selectionFile = "late-use-selection.json"

    static func status() -> [String: Any] {
        guard NativeFeatures.screenTime else { return ["available": false, "authorized": false, "picked": false] }
        return ["available": true,
                "authorized": AuthorizationCenter.shared.authorizationStatus == .approved,
                "picked": selection() != nil]
    }

    @MainActor
    static func requestAuthorization() async -> [String: Any] {
        guard NativeFeatures.screenTime else { return ["authorized": false, "reason": "off"] }
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            return ["authorized": AuthorizationCenter.shared.authorizationStatus == .approved]
        } catch {
            return ["authorized": false, "reason": "declined"]
        }
    }

    static func selection() -> FamilyActivitySelection? {
        let url = SharedStore.shared().directory.appendingPathComponent(selectionFile)
        guard let d = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: d)
    }

    static func save(_ sel: FamilyActivitySelection) {
        let url = SharedStore.shared().directory.appendingPathComponent(selectionFile)
        if let d = try? JSONEncoder().encode(sel) { try? d.write(to: url, options: .atomic) }
    }

    /// The system's app picker in a sheet; Done keeps the choice.
    @MainActor
    static func presentPicker(from vc: UIViewController, done: @escaping (Bool) -> Void) {
        guard NativeFeatures.screenTime else { done(false); return }
        let host = UIHostingController(rootView: PickerSheet(initial: selection() ?? FamilyActivitySelection()) { sel in
            if let sel { save(sel) }
            vc.dismiss(animated: true)
            done(sel != nil)
        })
        vc.present(host, animated: true)
    }

    private static func comps(_ hhmm: String) -> DateComponents {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        return DateComponents(hour: p.first ?? 22, minute: p.count > 1 ? p[1] : 0)
    }

    /// Monitor every night from bedtime to wake. False without authorization or a choice of apps.
    @MainActor
    static func schedule(bedtime: String, wake: String) -> Bool {
        guard NativeFeatures.screenTime, AuthorizationCenter.shared.authorizationStatus == .approved, let sel = selection() else { return false }
        let schedule = DeviceActivitySchedule(intervalStart: comps(bedtime), intervalEnd: comps(wake), repeats: true)
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        for m in thresholds {
            events[DeviceActivityEvent.Name("m\(m)")] = DeviceActivityEvent(
                applications: sel.applicationTokens, categories: sel.categoryTokens, webDomains: sel.webDomainTokens,
                threshold: DateComponents(minute: m))
        }
        let center = DeviceActivityCenter()
        center.stopMonitoring([activity])
        do {
            try center.startMonitoring(activity, during: schedule, events: events)
            return true
        } catch {
            return false
        }
    }

    /// { night (the evening's date): minutes } as the monitor wrote them.
    static func readNights() -> [String: Int] {
        let url = SharedStore.shared().directory.appendingPathComponent(LateUseLog.file)
        guard let d = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONDecoder().decode([String: Int].self, from: d)) ?? [:]
    }
}

private struct PickerSheet: View {
    @State var selection: FamilyActivitySelection
    let done: (FamilyActivitySelection?) -> Void

    init(initial: FamilyActivitySelection, done: @escaping (FamilyActivitySelection?) -> Void) {
        _selection = State(initialValue: initial)
        self.done = done
    }

    var body: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Apps that count")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil) } }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { done(selection) } }
                }
        }
        .preferredColorScheme(.dark)
    }
}
