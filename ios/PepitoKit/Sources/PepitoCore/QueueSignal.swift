import Foundation

/// A cross-process nudge: "the queue has something new". A widget button or an
/// App Intent posts it after appending; the app, if it is running, drains the
/// queue straight away instead of waiting for the next resume.
public enum QueueSignal {
    public static let name = "com.buzz.pepito.queue-changed"

    public static func post() {
        #if canImport(Darwin)
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name as CFString), nil, nil, true)
        #endif
    }

    #if canImport(Darwin)
    /// Call `handler` on the main queue whenever the signal is posted.
    public static func observe(_ handler: @escaping () -> Void) {
        let box = Unmanaged.passRetained(HandlerBox(handler)).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(), box,
            { _, observer, _, _, _ in
                guard let observer else { return }
                let h = Unmanaged<HandlerBox>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async { h.handler() }
            },
            name as CFString, nil, .deliverImmediately)
    }

    private final class HandlerBox {
        let handler: () -> Void
        init(_ h: @escaping () -> Void) { handler = h }
    }
    #endif
}
