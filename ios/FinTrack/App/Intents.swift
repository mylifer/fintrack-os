import AppIntents
import FinTrackCore

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

/// "Bu ay ne kadar harcadım?" — uygulamayı açmadan, widget özetinden (App
/// Group) cevaplar. Cihaz kilitliyse önce kilit açılır; "Tutarları gizle"
/// açıksa tutar söylenmez.
struct MonthSpendIntent: AppIntent {
    static let title: LocalizedStringResource = "Bu ayın harcaması"
    static let description = IntentDescription("Bu ay ne kadar harcadığını ve bütçe durumunu söyler.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: Self.answer(WidgetSnapshot.load())))
    }

    static func answer(_ s: WidgetSnapshot?, today: String = DateUtil.today()) -> String {
        guard let s, s.month == String(today.prefix(7)) else {
            return "Bu ayın özeti henüz yok. FinTrack'i bir kez açınca hazır olur."
        }
        let month = s.monthTitle.components(separatedBy: " ").first ?? s.monthTitle
        var parts: [String] = []
        if s.amountsHidden {
            parts.append("Tutarlar gizli. Ayrıntılar için FinTrack'i aç.")
        } else {
            parts.append("\(month) ayında \(Fmt.whole(s.expense)) harcadın.")
            if s.income > 0 { parts.append("Gelir \(Fmt.whole(s.income)).") }
        }
        if s.budgetLimit > 0 {
            parts.append("Bütçelerin yüzde \((s.budgetSpent / s.budgetLimit * 100).rounded().safeInt) kadarı kullanıldı.")
        }
        if s.pendingCount > 0 { parts.append("Onay bekleyen \(s.pendingCount) işlem var.") }
        // Özet uygulamanın son açılışından: eskiyse söyle
        if Date().timeIntervalSince(s.updatedAt) > 6 * 3600 {
            parts.append("Son güncelleme \(s.updatedAt.formatted(.relative(presentation: .named).locale(Locale(identifier: "tr_TR")))).")
        }
        return parts.joined(separator: " ")
    }
}

struct FinTrackShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: QuickAddIntent(), phrases: [
            "\(.applicationName) ile harcama ekle",
            "\(.applicationName) ile işlem ekle",
            "\(.applicationName)'e harcama ekle",
        ], shortTitle: "İşlem ekle", systemImageName: "plus.circle")
        AppShortcut(intent: MonthSpendIntent(), phrases: [
            "\(.applicationName) bu ay ne kadar harcadım",
            "\(.applicationName) harcamam ne kadar",
            "\(.applicationName) bu ayın harcaması",
        ], shortTitle: "Bu ayın harcaması", systemImageName: "turkishlirasign.circle")
        AppShortcut(intent: OpenBudgetsIntent(), phrases: [
            "\(.applicationName) bütçelerim",
            "\(.applicationName) bütçeleri göster",
        ], shortTitle: "Bütçeler", systemImageName: "chart.pie")
    }
}
