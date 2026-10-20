// swift-tools-version: 5.9
// Shared by the iPhone app, its widgets and Live Activity, the Watch app and
// the Watch widgets.
//
//   PepitoCore   the snapshot and action-queue model, the App Group store and
//                the pure logic every surface needs (which doses to show, what
//                a tap changes, heart-rate zones). Foundation only, so its tests
//                also run on Linux: `swift test` in this folder.
//   PepitoTheme  the v28 design tokens, ported from src/index.css (SwiftUI).
// macOS is listed only so `swift test` runs on a Mac (CI); nothing ships there.
import PackageDescription

let package = Package(
    name: "PepitoKit",
    platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
    products: [
        .library(name: "PepitoCore", targets: ["PepitoCore"]),
        .library(name: "PepitoTheme", targets: ["PepitoTheme"])
    ],
    targets: [
        .target(name: "PepitoCore"),
        .target(name: "PepitoTheme"),
        .testTarget(
            name: "PepitoCoreTests",
            dependencies: ["PepitoCore"],
            resources: [.copy("Fixtures")]
        )
    ]
)
