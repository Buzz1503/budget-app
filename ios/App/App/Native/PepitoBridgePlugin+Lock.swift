import Foundation
import UIKit
import LocalAuthentication
import Capacitor

/// The optional Face ID lock. The web layer decides when to ask (on launch,
/// and on return after the chosen grace period); this asks iOS. Face ID with
/// the passcode as the fallback, so a failed face never locks you out.
/// Widgets, notifications and the Watch keep working while the app is locked:
/// none of them go through the web view.
extension PepitoBridgePlugin {
    @objc func biometryType(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let can = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        let kind: String
        switch ctx.biometryType {
        case .faceID: kind = "faceID"
        case .touchID: kind = "touchID"
        case .opticID: kind = "opticID"
        default: kind = "none"
        }
        call.resolve(["available": can, "type": kind])
    }

    @objc func authenticate(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Not now"
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock Pepito+") { ok, _ in
            call.resolve(["unlocked": ok])
        }
    }

    /// While the lock is on, the app switcher shows a plain cover, not the app.
    @objc func setPrivacyCover(_ call: CAPPluginCall) {
        PrivacyCover.enabled = call.getBool("enabled") ?? false
        call.resolve()
    }
}

enum PrivacyCover {
    static var enabled = false
    private static let tag = 0x5E7170

    static func show() {
        guard enabled else { return }
        DispatchQueue.main.async {
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
                  window.viewWithTag(tag) == nil else { return }
            let cover = UIView(frame: window.bounds)
            cover.tag = tag
            cover.backgroundColor = UIColor(red: 8 / 255, green: 10 / 255, blue: 18 / 255, alpha: 1)
            cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            window.addSubview(cover)
        }
    }

    static func hide() {
        DispatchQueue.main.async {
            for scene in UIApplication.shared.connectedScenes {
                (scene as? UIWindowScene)?.windows.forEach { $0.viewWithTag(tag)?.removeFromSuperview() }
            }
        }
    }
}
