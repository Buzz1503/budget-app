import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

/// The App Group container: the snapshot and the pending-actions queue.
///
/// The app, the widget extension and App Intents all read and write these files,
/// sometimes at the same moment, so every write takes an exclusive lock on a
/// lock file first and replaces the file atomically. On the Watch the same type
/// points at the Watch's own App Group (the phone and the Watch do not share a
/// container; WatchConnectivity carries the data between them).
public final class SharedStore: @unchecked Sendable {
    public static let appGroup = "group.com.buzz.pepito"
    public static let snapshotFile = "snapshot.json"
    public static let queueFile = "pending-actions.json"
    private static let lockFile = ".pepito.lock"
    /// A queue is never allowed to grow without bound if the app is not opened for weeks.
    public static let maxQueued = 2000

    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    #if os(iOS) || os(watchOS) || os(macOS)
    /// The shared container, or the app's own Application Support folder when
    /// the App Group is not available (see NativeFeatures.appGroup).
    public static func shared() -> SharedStore {
        if NativeFeatures.appGroup,
           let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return SharedStore(directory: url.appendingPathComponent("Pepito", isDirectory: true))
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return SharedStore(directory: support.appendingPathComponent("Pepito", isDirectory: true))
    }
    #endif

    // MARK: locking

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        let path = directory.appendingPathComponent(SharedStore.lockFile).path
        let fd = open(path, O_CREAT | O_RDWR, 0o644)
        if fd >= 0 { _ = flock(fd, LOCK_EX) }
        defer {
            if fd >= 0 { _ = flock(fd, LOCK_UN); close(fd) }
        }
        return try body()
    }

    private func url(_ name: String) -> URL { directory.appendingPathComponent(name) }

    // MARK: snapshot

    public func snapshotData() -> Data? {
        withLock { try? Data(contentsOf: url(SharedStore.snapshotFile)) }
    }

    public func readSnapshot() -> Snapshot? {
        guard let data = snapshotData() else { return nil }
        return try? Snapshot.decode(data)
    }

    /// The web layer's JSON, written as it came.
    public func writeSnapshot(data: Data) throws {
        try withLock { try data.write(to: url(SharedStore.snapshotFile), options: .atomic) }
    }

    public func writeSnapshot(_ snapshot: Snapshot) throws {
        try writeSnapshot(data: snapshot.encoded())
    }

    /// Read, change and write the snapshot under one lock, so a widget tap and
    /// the app writing at the same moment cannot lose each other's change.
    @discardableResult
    public func updateSnapshot(_ change: (inout Snapshot) -> Void) -> Snapshot? {
        withLock {
            guard let data = try? Data(contentsOf: url(SharedStore.snapshotFile)),
                  var snap = try? Snapshot.decode(data) else { return nil }
            change(&snap)
            if let out = try? snap.encoded() { try? out.write(to: url(SharedStore.snapshotFile), options: .atomic) }
            return snap
        }
    }

    // MARK: queue

    private func readQueueUnlocked() -> [PendingAction] {
        guard let data = try? Data(contentsOf: url(SharedStore.queueFile)) else { return [] }
        return (try? JSONDecoder().decode([PendingAction].self, from: data)) ?? []
    }

    private func writeQueueUnlocked(_ actions: [PendingAction]) throws {
        let data = try JSONEncoder().encode(actions)
        try data.write(to: url(SharedStore.queueFile), options: .atomic)
    }

    /// Add an action. An id already queued is not added twice.
    public func append(_ action: PendingAction) throws {
        try withLock {
            var q = readQueueUnlocked()
            guard !q.contains(where: { $0.id == action.id }) else { return }
            q.append(action)
            if q.count > SharedStore.maxQueued { q.removeFirst(q.count - SharedStore.maxQueued) }
            try writeQueueUnlocked(q)
        }
    }

    public func append(_ actions: [PendingAction]) throws {
        for a in actions { try append(a) }
    }

    public func pendingActions() -> [PendingAction] {
        withLock { readQueueUnlocked() }
    }

    /// The queue as raw JSON, for the plugin to hand to the web layer as is.
    public func pendingActionsData() -> Data {
        withLock { (try? Data(contentsOf: url(SharedStore.queueFile))) ?? Data("[]".utf8) }
    }

    /// Remove the actions the web layer has applied (or set aside), by id.
    /// Anything appended since it read the queue stays.
    public func acknowledge(ids: [String]) throws {
        let gone = Set(ids)
        try withLock {
            let q = readQueueUnlocked().filter { !gone.contains($0.id) }
            try writeQueueUnlocked(q)
        }
    }
}
