#if os(watchOS)
import SwiftUI
import PepitoCore
import PepitoTheme

/// The Doses screen: "2 of 4 left", then each row with its name, its dose
/// line, and Log (or Take) and Skip side by side. A ticked row collapses to
/// "Logged 7:42 am" and the next one moves up. Double tap logs the top row.
public struct WatchDosesContent: View {
    let screen: WatchHome.DoseScreen
    let loggedAt: [String: Date]
    let willSync: Bool
    let onLog: (DoseBoard.Row) -> Void
    let onSkip: (DoseBoard.Row) -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    public init(screen: WatchHome.DoseScreen, loggedAt: [String: Date], willSync: Bool,
                onLog: @escaping (DoseBoard.Row) -> Void, onSkip: @escaping (DoseBoard.Row) -> Void) {
        self.screen = screen; self.loggedAt = loggedAt; self.willSync = willSync; self.onLog = onLog; self.onSkip = onSkip
    }

    public var body: some View {
        let topId = screen.rows.first { $0.status == .due }?.id
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s12) {
            Text(screen.left)
                .font(.system(size: 15, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Pal.text2)
                .contentTransition(.numericText())
            ForEach(screen.rows) { row in
                if row.status == .due {
                    DueRow(row: row, isTop: row.id == topId, dimmed: dimmed, onLog: onLog, onSkip: onSkip)
                        .transition(.opacity)
                } else {
                    DoneRow(row: row, at: loggedAt[row.id])
                        .transition(.opacity)
                }
            }
            if willSync {
                Label("Will sync", systemImage: "arrow.triangle.2.circlepath")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Pal.text2)
                    .accessibilityLabel("Will sync with your iPhone")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.snappy, value: screen.rows.map(\.status))
    }
}

struct DueRow: View {
    let row: DoseBoard.Row
    let isTop: Bool
    let dimmed: Bool
    let onLog: (DoseBoard.Row) -> Void
    let onSkip: (DoseBoard.Row) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s8) {
            VStack(alignment: .leading, spacing: 2) {
                if row.isGroup {
                    Text("Draw together").font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                }
                ForEach(row.items) { i in
                    Text(i.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text).lineLimit(2)
                }
                Text(WatchHome.doseLine(row))
                    .font(PepitoTheme.number(15, weight: .medium))
                    .foregroundStyle(Pal.text2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .accessibilityElement(children: .combine)
            if !dimmed {
                HStack(spacing: PepitoTheme.Space.s8) {
                    Button { onLog(row) } label: {
                        Image(systemName: "checkmark").font(.system(size: 20, weight: .bold))
                    }
                    .buttonStyle(WatchPrimaryButtonStyle())
                    .pepitoPrimaryGesture(isTop)
                    .accessibilityLabel(row.speech)
                    Button { onSkip(row) } label: {
                        Image(systemName: "xmark").font(.system(size: 18, weight: .bold))
                    }
                    .buttonStyle(WatchSecondaryButtonStyle(height: 52))
                    .accessibilityLabel("Skip \(row.title)")
                }
            }
        }
    }
}

struct DoneRow: View {
    let row: DoseBoard.Row
    let at: Date?

    var body: some View {
        let skipped = row.status == .skipped
        HStack(spacing: PepitoTheme.Space.s8) {
            Image(systemName: skipped ? "xmark.circle" : "checkmark.circle.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(skipped ? Pal.text2 : Pal.accent)
            VStack(alignment: .leading, spacing: 0) {
                Text(row.items.map(\.name).joined(separator: " + "))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Pal.text2)
                    .lineLimit(1)
                Text(status(skipped))
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Pal.text2)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func status(_ skipped: Bool) -> String {
        if skipped { return "Skipped" }
        let verb = row.verb == "Take" ? "Taken" : "Logged"
        return at.map { "\(verb) \(Clock.time($0))" } ?? verb
    }
}

/// Right after a tick that leaves a vial about empty: one question, two answers.
/// Yes starts the next vial (the iPhone shows the mixing recipe); Still some left
/// keeps this one open and asks again at the next log.
public struct WatchVialQuestionContent: View {
    let name: String
    let onYes: () -> Void
    let onStill: () -> Void

    public init(name: String, onYes: @escaping () -> Void, onStill: @escaping () -> Void) {
        self.name = name; self.onYes = onYes; self.onStill = onStill
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: PepitoTheme.Space.s12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2).lineLimit(1)
                Text("This vial should be about empty. Start a new one?")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Pal.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            Button(action: onYes) { Text("Yes") }
                .buttonStyle(WatchPrimaryButtonStyle())
            Button(action: onStill) { Text("Still some left").lineLimit(1).minimumScaleFactor(0.85) }
                .buttonStyle(WatchSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Everything in the slot is logged: a full-screen tick, "All logged" and the next slot.
public struct WatchAllLoggedContent: View {
    let next: String?
    let bounce: Int
    @Environment(\.isLuminanceReduced) private var dimmed

    public init(next: String?, bounce: Int = 0) { self.next = next; self.bounce = bounce }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64, weight: .semibold))
                .foregroundStyle(dimmed ? Pal.accent.opacity(0.6) : Pal.accent)
                .symbolEffect(.bounce, value: bounce)
            Text("All logged").font(.system(size: 20, weight: .semibold)).foregroundStyle(Pal.text)
            Text(next.map { "Next \($0)" } ?? "Nothing else due this week")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Pal.text2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Before the first snapshot, or with the whole protocol paused.
public struct WatchMessageContent: View {
    let symbol: String
    let title: String
    let detail: String?
    public init(symbol: String, title: String, detail: String?) { self.symbol = symbol; self.title = title; self.detail = detail }
    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            Image(systemName: symbol)
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 40, weight: .semibold))
                .foregroundStyle(Pal.text2)
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text).multilineTextAlignment(.center)
            if let detail {
                Text(detail).font(.system(size: 15, weight: .medium)).foregroundStyle(Pal.text2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// The bottom toolbar button.
public struct WatchLogAllLabel: View {
    let count: Int
    let verb: String
    public init(count: Int, verb: String) { self.count = count; self.verb = verb }
    public var body: some View {
        Label("\(verb) all", systemImage: "checkmark")
            .accessibilityLabel("\(verb) all \(count)")
    }
}
#endif
