import SwiftUI
import FinTrackCore
import FinTrackData

@main
struct FinTrackApp: App {
    @State private var model = AppModel()
    @State private var lock = AppLock()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Fmt.amountsHidden = UserDefaults.standard.bool(forKey: "fintrack.amountsHidden")
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(lock)
                .tint(Theme.tint)
                .task { await model.start(config: AppConfig.fromBundle()) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lock.lockIfNeeded()
            case .active:
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
        ZStack {
            content
                // Tutarları gizle: biçimleyici modül düzeyinde bir bayrak; değişince
                // ekran yeniden kurulur ki biçimlenmiş tüm tutarlar yenilensin (web PrivacyProvider).
                .id(amountsHidden)

            // Kilit yalnız oturum açıkken anlamlı; uygulama değiştiricide
            // (inactive) içerik de gizlenir.
            if model.userId != nil && (lock.isLocked || scenePhase != .active) {
                LockView().transition(.opacity)
            }
        }
        .onChange(of: amountsHidden, initial: true) { _, v in Fmt.amountsHidden = v }
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
