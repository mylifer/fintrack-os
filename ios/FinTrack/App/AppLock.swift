import SwiftUI
import LocalAuthentication

/// Face ID kilidi (web'deki PIN kilidinin yerine). Uygulama arka plana geçince
/// kilitlenir; açarken Face ID, olmazsa cihaz parolası.
@MainActor
@Observable
final class AppLock {
    private static let enabledKey = "fintrack.faceIDEnabled"

    var isEnabled: Bool {
        didSet { UserDefaults.standard.set(isEnabled, forKey: Self.enabledKey) }
    }
    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    var errorMessage: String?

    init() {
        let stored = UserDefaults.standard.object(forKey: Self.enabledKey) as? Bool ?? true
        isEnabled = stored
        isLocked = stored
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

    func lockIfNeeded() {
        if isEnabled { isLocked = true }
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
