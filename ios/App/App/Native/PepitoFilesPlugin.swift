import Foundation
import UIKit
import Capacitor

/**
 * PepitoFiles: the app's own files in its Documents folder, which the Files
 * app shows under On My iPhone › Pepito+ (UIFileSharingEnabled,
 * LSSupportsOpeningDocumentsInPlace). Daily backups go in "Backups", doctor
 * reports in "Reports". Nothing here leaves the phone unless you share it.
 */
@objc(PepitoFilesPlugin)
public class PepitoFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoFilesPlugin"
    public let jsName = "PepitoFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    private let fm = FileManager.default

    /// Only "Backups" or "Reports", and a plain file name: nothing can reach outside them.
    private func url(_ folder: String?, _ name: String? = nil) -> URL? {
        guard let folder, ["Backups", "Reports"].contains(folder),
              let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
        let dir = docs.appendingPathComponent(folder, isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let name else { return dir }
        guard !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else { return nil }
        return dir.appendingPathComponent(name)
    }

    /// Text as UTF-8 (`text`) or binary as base64 (`base64`).
    @objc func write(_ call: CAPPluginCall) {
        guard let target = url(call.getString("folder"), call.getString("name")) else { call.resolve(["saved": false]); return }
        let data: Data?
        if let b64 = call.getString("base64") { data = Data(base64Encoded: b64) } else { data = call.getString("text")?.data(using: .utf8) }
        guard let data else { call.resolve(["saved": false]); return }
        do {
            try data.write(to: target, options: [.atomic, .completeFileProtection])
            call.resolve(["saved": true, "name": target.lastPathComponent])
        } catch {
            call.resolve(["saved": false])
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let dir = url(call.getString("folder")) else { call.resolve(["files": []]); return }
        let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
        let files: [[String: Any]] = items.compactMap { u in
            guard let v = try? u.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]) else { return nil }
            return ["name": u.lastPathComponent, "size": v.fileSize ?? 0,
                    "modified": (v.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000]
        }
        call.resolve(["files": files])
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let target = url(call.getString("folder"), call.getString("name")),
              let text = try? String(contentsOf: target, encoding: .utf8) else { call.resolve(["text": NSNull()]); return }
        call.resolve(["text": text])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let target = url(call.getString("folder"), call.getString("name")) else { call.resolve(["removed": false]); return }
        call.resolve(["removed": (try? fm.removeItem(at: target)) != nil])
    }

    /// The share sheet for one file: Mail, Messages, AirDrop, Save to Files.
    @objc func share(_ call: CAPPluginCall) {
        guard let target = url(call.getString("folder"), call.getString("name")), fm.fileExists(atPath: target.path) else {
            call.resolve(["shared": false]); return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.resolve(["shared": false]); return }
            let sheet = UIActivityViewController(activityItems: [target], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.completionWithItemsHandler = { _, done, _, _ in call.resolve(["shared": done]) }
            vc.present(sheet, animated: true)
        }
    }
}
