import SwiftUI
import UserNotifications
import FinTrackCore
import FinTrackData

@main
struct FinTrackApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()
    @State private var lock = AppLock()
    @State private var router = Router.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Fmt.amountsHidden = UserDefaults.standard.bool(forKey: "fintrack.amountsHidden")
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
        CSVFile.cleanUp()
    }

    /// DEBUG `-noautounlock`: kilit ekranı doğrulamasında istem açılmasın
    private static var noAutoUnlock: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-noautounlock")
        #else
        false
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(lock)
                .environment(router)
                .tint(Theme.tint)
                .onOpenURL { router.open($0) }
                #if DEBUG
                // `-openurl <url>`: bağlantı/kısayol yönlendirmesini simülatörde dene
                .onAppear {
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-openurl"), i + 1 < args.count, let u = URL(string: args[i + 1]) { router.open(u) }
                }
                #endif
                .task { await model.start(config: AppConfig.fromBundle()) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                lock.didEnterBackground()
                // Yerel değişiklikler (onay, yeni işlem) hatırlatmalara yansısın
                Reminders.schedule(model)
            case .active:
                lock.willBecomeActive()
                if lock.isLocked && !Self.noAutoUnlock { Task { await lock.unlock() } }
                model.refreshDerivedIfStale()
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
        // Türetim (kart ekstreleri dahil) tamamlanınca: bayat ekstreden hatırlatma kurulmasın
        .onChange(of: model.derivedStamp) { Reminders.schedule(model) }
        .onChange(of: model.userId) { _, id in
            if id == nil {
                Task { await Reminders.clear() }
                CSVFile.cleanUp()
            }
        }
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
