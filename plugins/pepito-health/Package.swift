// swift-tools-version: 5.9
// The package name must equal what the Capacitor CLI derives from the npm name
// ("pepito-health" -> "PepitoHealth"), or `cap sync` writes a reference SPM
// cannot resolve.
import PackageDescription

let package = Package(
    name: "PepitoHealth",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "PepitoHealth",
            targets: ["PepitoHealthPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "PepitoHealthPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/PepitoHealthPlugin"
        )
    ]
)
