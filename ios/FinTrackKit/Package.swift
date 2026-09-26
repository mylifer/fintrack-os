// swift-tools-version: 6.0
import PackageDescription

// FinTrackCore: saf mantık (modeller, para, tarih, hesaplar) — bağımlılık yok,
//   `swift test` ile Mac'te simülatörsüz çalışır. Web'in src/lib/utils/*.ts
//   karşılıkları burada; testleri web'deki *.test.ts girdileriyle aynıdır.
// FinTrackData: Supabase istemcisi, oturum/MFA, okuma-yazma ve uygulama durumu.
let package = Package(
    name: "FinTrackKit",
    defaultLocalization: "tr",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FinTrackCore", targets: ["FinTrackCore"]),
        .library(name: "FinTrackData", targets: ["FinTrackData"]),
    ],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0"),
    ],
    targets: [
        .target(name: "FinTrackCore"),
        .target(
            name: "FinTrackData",
            dependencies: [
                "FinTrackCore",
                .product(name: "Supabase", package: "supabase-swift"),
            ]
        ),
        .testTarget(name: "FinTrackCoreTests", dependencies: ["FinTrackCore"]),
    ]
)
