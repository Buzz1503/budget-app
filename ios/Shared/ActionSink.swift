import Foundation
import WidgetKit
import PepitoCore

/// Where every native tap on the iPhone side goes: a widget button, a
/// notification action, Siri, the Live Activity, or a message from the Watch.
///
/// The action is queued for the web layer (which applies it through the store,
/// once), the snapshot is changed at once so every surface shows the tick, the
/// widgets reload, and the app is nudged in case it is running.
/// Compiled into the app and the widget extension.
enum ActionSink {
    static func record(_ action: PendingAction, now: Date = Date()) {
        let store = SharedStore.shared()
        try? store.append(action)
        store.updateSnapshot { $0.apply(action, now: now) }
        WidgetCenter.shared.reloadAllTimelines()
        QueueSignal.post()
    }

    static func record(_ actions: [PendingAction], now: Date = Date()) {
        guard !actions.isEmpty else { return }
        let store = SharedStore.shared()
        try? store.append(actions)
        store.updateSnapshot { snap in for a in actions { snap.apply(a, now: now) } }
        WidgetCenter.shared.reloadAllTimelines()
        QueueSignal.post()
    }

    static func snapshot() -> Snapshot? { SharedStore.shared().readSnapshot() }
}
