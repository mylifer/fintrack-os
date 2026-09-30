import SwiftUI
import UserNotifications
import FinTrackCore
import FinTrackData

@main
struct FinTrackApp: App {
    @State private var model = AppModel()
    @State private var lock = AppLock()
    @State private var router = Router.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Fmt.amountsHidden = UserDefaults.standard.bool(forKey: "fintrack.amountsHidden")
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(lock)
                .environment(router)
                .tint(Theme.tint)
                .onOpenURL { router.open($0) }
                .task { await model.start(config: AppConfig.fromBundle()) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lock.didEnterBackground()
                // Yerel değişiklikler (onay, yeni işlem) hatırlatmalara yansısın
                Task { await Reminders.reschedule(model) }
            case .active:
                lock.willBecomeActive()
                // Başka cihazdaki değişiklikler — açılışta tazele
                if model.userId != nil { Task { await model.refresh() } }
            default:
                break
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("fintrack.amountsHidden") private var amountsHidden = false

    var body: some View {
        content
            // Tutarları gizle: biçimleyici modül düzeyinde bir bayrak; değişince
            // ekran yeniden kurulur ki biçimlenmiş tüm tutarlar yenilensin (web PrivacyProvider).
            .id(amountsHidden)
            // Kilit yalnız oturum açıkken anlamlı; uygulama değiştiricide (inactive)
            // içerik de gizlenir. Ayrı pencerede: açık sayfaları da örter.
            .onChange(of: overlayMode, initial: true) { _, m in SecureOverlay.shared.update(m, lock: lock) }
        .onChange(of: amountsHidden, initial: true) { _, v in
            Fmt.amountsHidden = v
            model.amountsHiddenChanged()
        }
        .onChange(of: model.lastSync) { Task { await Reminders.reschedule(model) } }
        .onChange(of: model.userId) { _, id in if id == nil { Task { await Reminders.clear() } } }
    }

    private var overlayMode: SecureOverlay.Mode {
        guard model.userId != nil else { return .none }
        if lock.isLocked { return .lock }
        return scenePhase == .active ? .none : .cover
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .starting:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .missingConfig:
            MissingConfigView()
        case .ready:
            switch model.auth {
            case .signedOut: LoginView()
            case .needsMFA: MFAView()
            case .signedIn: MainTabView()
            }
        }
    }
}

struct MissingConfigView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Supabase anahtarları yok", systemImage: "key.slash")
        } description: {
            Text("ios/scripts/make-secrets.sh betiğini çalıştırıp uygulamayı yeniden derleyin. Anahtarlar .env.local'dan okunur ve git'e girmez.")
        }
    }
}
