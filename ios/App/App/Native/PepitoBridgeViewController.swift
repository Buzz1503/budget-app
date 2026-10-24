import UIKit
import Capacitor

/// The Capacitor web view, with the app's own plugin registered. PepitoBridge
/// lives in the app target because it drives code that only the app has
/// (notifications, the Live Activity, the Watch link).
class PepitoBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PepitoBridgePlugin())
        bridge?.registerPluginInstance(PepitoSleepPlugin())
        bridge?.registerPluginInstance(PepitoFilesPlugin())
    }
}
