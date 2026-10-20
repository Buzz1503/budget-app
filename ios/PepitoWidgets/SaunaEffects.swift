import Foundation

/// The sauna intents are Live Activity intents, so iOS runs them in the app,
/// where SaunaEffects starts the Live Activity and the Watch workout. This copy
/// only exists so the shared intent code compiles in the widget extension.
enum SaunaEffects {
    static func started(at: Date, targetMin: Int, tempC: Int) async {}
    static func stopped() async {}
}
