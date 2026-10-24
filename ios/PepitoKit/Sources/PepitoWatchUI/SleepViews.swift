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
/// The evening sheet: Nothing unusual, then the evening items with your last
/// amounts, drinks, and the other factors as quick toggles, then Save.
public struct WatchEveningContent: View {
    let sedatives: [Snapshot.AsNeeded]
    /// item id to the amount chosen (taken tonight)
    let taken: [String: Double]
    let drinks: Int
    let toggles: [Snapshot.Toggle]
    let on: Set<String>
    let onNothing: () -> Void
    let onSedative: (Snapshot.AsNeeded) -> Void
    let onDrinks: (Int) -> Void
    let onToggle: (String) -> Void
    let onSave: () -> Void

    public init(sedatives: [Snapshot.AsNeeded], taken: [String: Double], drinks: Int, toggles: [Snapshot.Toggle], on: Set<String>,
                onNothing: @escaping () -> Void, onSedative: @escaping (Snapshot.AsNeeded) -> Void, onDrinks: @escaping (Int) -> Void,
                onToggle: @escaping (String) -> Void, onSave: @escaping () -> Void) {
        self.sedatives = sedatives; self.taken = taken; self.drinks = drinks; self.toggles = toggles; self.on = on
        self.onNothing = onNothing; self.onSedative = onSedative; self.onDrinks = onDrinks; self.onToggle = onToggle; self.onSave = onSave
    }

    private func check(_ yes: Bool) -> some View {
        Image(systemName: yes ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(yes ? Pal.accent : Pal.text3)
    }

    public var body: some View {
        VStack(spacing: PepitoTheme.Space.s8) {
            Button(action: onNothing) { Text("Nothing unusual") }
                .buttonStyle(WatchSecondaryButtonStyle(height: 44))
            ForEach(sedatives) { i in
                Button { onSedative(i) } label: {
                    HStack(spacing: PepitoTheme.Space.s8) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(i.short).font(.system(size: 15, weight: .semibold)).foregroundStyle(Pal.text)
                            Text(taken[i.id].map { "\(AsNeededPicker.words($0)) \(AsNeededPicker.unit(i))" }
                                 ?? i.last.map { "Last \(AsNeededPicker.words($0)) \(i.lastUnit ?? i.units.first ?? "")" } ?? "Set amount")
                                .font(.system(size: 13, weight: .medium)).foregroundStyle(Pal.text2)
                        }
                        Spacer(minLength: 0)
                        check(taken[i.id] != nil)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(WatchTileStyle())
                .accessibilityAddTraits(taken[i.id] != nil ? .isSelected : [])
            }
            HStack(spacing: PepitoTheme.Space.s8) {
                Button { onDrinks(max(0, drinks - 1)) } label: { Image(systemName: "minus") }
                    .buttonStyle(WatchSecondaryButtonStyle(height: 36))
                    .accessibilityLabel("One drink less")
                VStack(spacing: 0) {
                    Text("\(drinks)").font(.system(size: 20, weight: .bold).monospacedDigit()).foregroundStyle(Pal.text)
                    Text(drinks == 1 ? "drink" : "drinks").font(.system(size: 12, weight: .medium)).foregroundStyle(Pal.text2)
                }
                .frame(minWidth: 44)
                .accessibilityElement(children: .combine)
                Button { onDrinks(drinks + 1) } label: { Image(systemName: "plus") }
                    .buttonStyle(WatchSecondaryButtonStyle(height: 36))
                    .accessibilityLabel("One drink more")
            }
            ForEach(toggles) { t in
                Button { onToggle(t.id) } label: {
                    HStack {
                        Text(t.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Pal.text).lineLimit(2)
                        Spacer(minLength: 0)
                        check(on.contains(t.id))
                    }
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                }
                .buttonStyle(WatchTileStyle())
                .accessibilityAddTraits(on.contains(t.id) ? .isSelected : [])
            }
            Button(action: onSave) { Label("Save", systemImage: "checkmark") }
                .buttonStyle(WatchPrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
    }
}
#endif
