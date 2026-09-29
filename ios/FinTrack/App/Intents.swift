import AppIntents

/// "FinTrack ile harcama ekle" — Siri, Kestirmeler, Spotlight ve Eylem düğmesi.
/// Uygulamayı hızlı ekleme sayfasıyla açar (kilit açıksa Face ID sorulur).
struct QuickAddIntent: AppIntent {
    static let title: LocalizedStringResource = "İşlem ekle"
    static let description = IntentDescription("FinTrack'i yeni işlem sayfasıyla açar.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        Router.shared.quickAdd = true
        return .result()
    }
}

struct OpenBudgetsIntent: AppIntent {
    static let title: LocalizedStringResource = "Bütçeleri göster"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        Router.shared.openPlan(.budgets)
        return .result()
    }
}

struct FinTrackShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: QuickAddIntent(), phrases: [
            "\(.applicationName) ile harcama ekle",
            "\(.applicationName) ile işlem ekle",
            "\(.applicationName)'e harcama ekle",
        ], shortTitle: "İşlem ekle", systemImageName: "plus.circle")
        AppShortcut(intent: OpenBudgetsIntent(), phrases: [
            "\(.applicationName) bütçelerim",
            "\(.applicationName) bütçeleri göster",
        ], shortTitle: "Bütçeler", systemImageName: "chart.pie")
    }
}
