import SwiftUI
import LocalAuthentication

/// Face ID kilidi (web'deki PIN kilidinin yerine). Uygulama arka plana geçip
/// seçilen süreden uzun kalınca kilitlenir; açarken Face ID, olmazsa cihaz parolası.
@MainActor
@Observable
final class AppLock {
    private static let enabledKey = "fintrack.faceIDEnabled"
    private static let graceKey = "fintrack.lockGraceSeconds"

    /// Arka planda kalma süresi seçenekleri (sn). 0 = hemen.
    static let graceOptions: [(seconds: Int, label: String)] = [
        (0, "Hemen"), (60, "1 dakika sonra"), (300, "5 dakika sonra"), (900, "15 dakika sonra"),
    ]

    var isEnabled: Bool {
        didSet { UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey) }
    }
    var graceSeconds: Int {
        didSet { UserDefaults.standard.set(graceSeconds, forKey: Self.graceKey) }
    }
    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    var errorMessage: String?
    private var backgroundedAt: Date?

    init() {
        let stored = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
        isEnabled = stored
        isLocked = stored
        graceSeconds = UserDefaults.standard.integer(forKey: Self.graceKey)
        #if DEBUG
        // Örnek veri modu (simülatör ekran doğrulaması): kilit yok
        if ProcessInfo.processInfo.arguments.contains("-demo") { isLocked = false }
        #endif
    }

    /// Cihazda biyometri var mı ve adı ne ("Face ID" / "Touch ID").
    var biometryName: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "Cihaz parolası"
        }
    }

    /// Arka plana geçiş: süre "hemen" ise hemen kilitle, değilse zamanı not et.
    func didEnterBackground() {
        backgroundedAt = Date()
        if isEnabled && graceSeconds == 0 { isLocked = true }
    }

    /// Öne dönüş: arka planda seçilen süreden uzun kalındıysa kilitle.
    /// (Saat geri alınırsa negatif süre de kilitler.)
    func willBecomeActive() {
        defer { backgroundedAt = nil }
        guard isEnabled, let at = backgroundedAt else { return }
        let elapsed = Date().timeIntervalSince(at)
        if elapsed < 0 || elapsed >= Double(graceSeconds) { isLocked = true }
    }

    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        guard isEnabled else { isLocked = false; return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Vazgeç"
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // Cihazda parola bile yoksa kilit anlamsız — açık bırak
            isLocked = false
            return
        }
        do {
            if try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "FinTrack'i açmak için") {
                isLocked = false
                errorMessage = nil
            }
        } catch {
            errorMessage = "Kilit açılamadı."
        }
    }
}

struct LockView: View {
    @Environment(AppLock.self) private var lock

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "lock.fill")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Theme.accent)
            Text("FinTrack kilitli").font(.title2.bold())
            if let e = lock.errorMessage {
                Text(e).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await lock.unlock() }
            } label: {
                Label("\(lock.biometryName) ile aç", systemImage: "faceid")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 32)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .task { await lock.unlock() }
    }
}

/// Uygulama değiştiricide / bildirim merkezi açıkken içeriği örten perde
/// (kilit kapalı olsa da tutarlar anlık görüntüde görünmesin).
struct PrivacyCover: View {
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Theme.onAccent)
                .frame(width: 64, height: 64)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            Text("FinTrack").font(.title3.bold())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .accessibilityHidden(true)
    }
}
