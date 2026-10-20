import WidgetKit
import SwiftUI

/// Every Home Screen and Lock Screen widget, and the sauna Live Activity.
@main
struct PepitoWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        SaunaWidget()
        ReadinessWidget()
        NextDoseInlineWidget()
    }
}
