#if os(watchOS)
import SwiftUI
import PepitoCore
import PepitoTheme

/// The last row of the Doses screen: one line naming the as-needed items.
public struct WatchAsNeededRow: View {
    let items: [Snapshot.AsNeeded]
    let onOpen: () -> Void

    public init(items: [Snapshot.AsNeeded], onOpen: @escaping () -> Void) { self.items = items; self.onOpen = onOpen }

    public var body: some View {
        Button(action: onOpen) {
            HStack(spacing: PepitoTheme.Space.s8) {
                Image(systemName: "plus.circle").font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text2)
                VStack(alignment: .leading, spacing: 0) {
                    Text("As needed").font(.system(size: 15, weight: .semibold)).foregroundStyle(Pal.text)
                    Text(items.prefix(3).map(\.short).joined(separator: ", "))
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("As needed: \(items.map(\.short).joined(separator: ", "))")
    }
}

/// Pick an as-needed item; this slot's come first.
public struct WatchAsNeededListContent: View {
    let items: [Snapshot.AsNeeded]
    let onPick: (Snapshot.AsNeeded) -> Void

    public init(items: [Snapshot.AsNeeded], onPick: @escaping (Snapshot.AsNeeded) -> Void) { self.items = items; self.onPick = onPick }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            ForEach(items) { i in
                Button { onPick(i) } label: {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(i.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Pal.text).lineLimit(2)
                        Text(i.last.map { "Last \(AsNeededPicker.words($0)) \(i.lastUnit ?? i.units.first ?? "")" } ?? "No amount yet")
                            .font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(WatchTileStyle())
            }
        }
    }
}

/// The amount, turned with the Crown from your last amount (or zero), the unit, then Log.
public struct WatchAsNeededAmountContent: View {
    let item: Snapshot.AsNeeded
    let amount: Double
    let unit: String
    let onUnit: (String) -> Void
    let onLog: () -> Void
    @Environment(\.watchMetrics) private var m

    public init(item: Snapshot.AsNeeded, amount: Double, unit: String, onUnit: @escaping (String) -> Void, onLog: @escaping () -> Void) {
        self.item = item; self.amount = amount; self.unit = unit; self.onUnit = onUnit; self.onLog = onLog
    }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            VStack(spacing: 0) {
                Text(AsNeededPicker.words(amount))
                    .font(PepitoTheme.number(m.hero))
                    .foregroundStyle(Pal.text)
                    .contentTransition(.numericText(value: amount))
                Text(amount > 0 ? unit : "Turn the Crown to set")
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(AsNeededPicker.words(amount)) \(unit)")
            if item.units.count > 1 {
                HStack(spacing: PepitoTheme.Space.s4) {
                    ForEach(item.units, id: \.self) { u in
                        Button(u) { onUnit(u) }
                            .buttonStyle(WatchSecondaryButtonStyle(height: 36))
                            .foregroundStyle(u == unit ? Pal.text : Pal.text2)
                            .accessibilityAddTraits(u == unit ? .isSelected : [])
                    }
                }
            }
            Button(action: onLog) { Label("Log", systemImage: "checkmark") }
                .buttonStyle(WatchPrimaryButtonStyle())
                .disabled(amount <= 0)
                .opacity(amount > 0 ? 1 : 0.5)
                .accessibilityLabel("Log \(item.name), \(AsNeededPicker.words(amount)) \(unit)")
        }
        .frame(maxWidth: .infinity)
    }
}
#endif
