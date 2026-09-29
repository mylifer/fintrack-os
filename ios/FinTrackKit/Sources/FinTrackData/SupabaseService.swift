import Foundation
import FinTrackCore
import Supabase

/// Uygulama anahtarları. Değerler git dışı `Secrets.xcconfig` → Info.plist'ten gelir.
public struct AppConfig: Sendable {
    public let supabaseURL: URL
    public let anonKey: String

    public init(supabaseURL: URL, anonKey: String) {
        self.supabaseURL = supabaseURL
        self.anonKey = anonKey
    }

    /// Info.plist'teki SUPABASE_URL / SUPABASE_ANON_KEY. Eksikse nil.
    public static func fromBundle(_ bundle: Bundle = .main) -> AppConfig? {
        guard let urlString = bundle.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              let url = URL(string: urlString), url.host != nil,
              let key = bundle.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String,
              !key.isEmpty, !key.hasPrefix("$(")
        else { return nil }
        return AppConfig(supabaseURL: url, anonKey: key)
    }
}

public enum AuthState: Equatable, Sendable {
    case signedOut
    /// Şifre doğru, ama hesapta doğrulama uygulaması var: oturum aal1, kod gerekli.
    /// aal1 oturumla RLS (0013) hiçbir satırı göstermez.
    case needsMFA(factorId: String)
    case signedIn(userId: String, email: String?)
}

public enum ServiceError: LocalizedError {
    case notSignedIn
    case message(String)

    public var errorDescription: String? {
        switch self {
        case .notSignedIn: "Oturum yok. Yeniden giriş yapın."
        case .message(let m): m
        }
    }
}

/// Supabase'e giden her şey burada. Web'deki src/lib/sync/engine.ts'in
/// okuma (fetchAllRows) ve yazma (flushOutbox → upsert) kuralları uygulanır;
/// çevrimdışı kuyruk ilk aşamada yok — yazma ağ ister.
public final class SupabaseService: Sendable {
    public let client: SupabaseClient

    public init(config: AppConfig) {
        client = SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.anonKey,
            options: SupabaseClientOptions(auth: .init(storage: DeviceKeychainStorage(),
                                                       emitLocalSessionAsInitialSession: true))
        )
    }

    // MARK: Oturum

    public func currentAuthState() async -> AuthState {
        let session: Session
        do {
            session = try await client.auth.session
        } catch {
            // Çevrimdışı açılış: süresi dolan belirteç yenilenemedi ama oturum
            // cihazda duruyor — çıkış sayma, önbellekle aç. Yalnız aal2 (MFA'sı
            // tamamlanmış) oturum; aksi halde kod ekranı çevrimiçi gerektirir.
            guard Self.isNetworkError(error), let local = client.auth.currentSession,
                  Self.assuranceLevel(local.accessToken) == "aal2" || !Self.hasTOTP(local.user)
            else { return .signedOut }
            return .signedIn(userId: local.user.id.uuidString.lowercased(), email: local.user.email)
        }
        if let factor = await pendingMFAFactor() { return .needsMFA(factorId: factor) }
        return .signedIn(userId: session.user.id.uuidString.lowercased(), email: session.user.email)
    }

    /// Oturum hâlâ geçerli mi? (Yenileme belirteci başka cihazdan iptal edildiyse
    /// ya da şifre değiştiyse false.) Ağ hatasında belirsiz → true.
    public func hasValidSession() async -> Bool {
        do {
            _ = try await client.auth.session
            return true
        } catch {
            return Self.isNetworkError(error)
        }
    }

    static func isNetworkError(_ error: Error) -> Bool {
        if error is URLError { return true }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return true }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSURLErrorDomain {
            return true
        }
        return false
    }

    /// JWT'nin "aal" iddiası (imza doğrulanmaz — yalnız yerel durum kararı).
    static func assuranceLevel(_ jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj["aal"] as? String
    }

    private static func hasTOTP(_ user: User) -> Bool {
        (user.factors ?? []).contains { $0.factorType == "totp" && $0.status == .verified }
    }

    public func signIn(email: String, password: String) async throws -> AuthState {
        do {
            try await client.auth.signIn(email: email, password: password)
        } catch {
            throw ServiceError.message(Self.friendlyAuthError(error))
        }
        return await currentAuthState()
    }

    /// Doğrulama uygulamasındaki 6 haneli kod → oturum aal2 olur.
    public func verifyMFA(factorId: String, code: String) async throws -> AuthState {
        do {
            _ = try await client.auth.mfa.challengeAndVerify(
                params: MFAChallengeAndVerifyParams(factorId: factorId, code: code))
        } catch {
            throw ServiceError.message("Kod doğrulanamadı. Uygulamadaki güncel kodu girin.")
        }
        return await currentAuthState()
    }

    public func signOut() async {
        try? await client.auth.signOut(scope: .local)
    }

    /// Hesapta doğrulanmış TOTP varsa ve oturum henüz aal2 değilse faktör kimliği.
    private func pendingMFAFactor() async -> String? {
        guard let aal = try? await client.auth.mfa.getAuthenticatorAssuranceLevel(),
              aal.nextLevel == "aal2", aal.currentLevel != "aal2",
              let factors = try? await client.auth.mfa.listFactors(),
              let totp = factors.totp.first
        else { return nil }
        return totp.id
    }

    static func friendlyAuthError(_ error: Error) -> String {
        let text = String(describing: error).lowercased()
        if text.contains("invalid login") || text.contains("invalid_credentials") {
            return "E-posta ya da şifre hatalı."
        }
        if text.contains("email not confirmed") { return "E-posta adresi henüz doğrulanmamış." }
        if text.contains("network") || text.contains("offline") || text.contains("nsurlerrordomain") {
            return "Bağlantı yok. İnternet bağlantınızı kontrol edin."
        }
        return "Giriş yapılamadı. (\(error.localizedDescription))"
    }

    // MARK: Okuma

    /// Üyesi olduğum ama SAHİBİ OLMADIĞIM paylaşılan alanlar (0021). complete=false
    /// ise okuma başarısız — çağıran bilinen listeyle devam eder.
    public func memberWorkspaceIds(userId: String) async -> (ids: [String], complete: Bool) {
        struct Membership: Decodable { let workspace_id: String; let role: String }
        do {
            let rows: [Membership] = try await client.from("workspace_members")
                .select("workspace_id, role")
                .eq("user_id", value: userId)
                .execute().value
            return (rows.filter { $0.role != "owner" }.map(\.workspace_id), true)
        } catch {
            return ([], false)   // tablo yoksa (0021 öncesi) ya da ağ hatası
        }
    }

    /// Tablonun tamamı — silinmişler (tombstone) DAHİL, anahtar tabanlı sayfalama
    /// (id > son okunan; PostgREST'in 1000 satır sınırını aşar, sayfa kayması olmaz).
    /// Kapsam: user_id = ben VEYA satırın alanı üyesi olduğum alanlardan (web ile aynı).
    public func fetchAll<T: SyncRecord>(_: T.Type, userId: String, memberIds: [String]) async throws -> [T] {
        let page = 1000
        var acc: [T] = []
        var lastId: String?
        let decoder = JSONDecoder()
        while true {
            var query = client.from(T.table).select("*")
            // PostgREST `or` filtresi metinle kurulur: yalnız UUID biçimli kimlikler
            // girer (sunucudan gelse de sözdizimi enjeksiyonuna kapı bırakma).
            let ids = memberIds.filter(Self.isUUID)
            if ids.isEmpty || !Self.isUUID(userId) {
                query = query.eq("user_id", value: userId)
            } else {
                let col = T.table == "workspaces" ? "id" : "workspaceId"
                let list = ids.map { "\"\($0)\"" }.joined(separator: ",")
                query = query.or("user_id.eq.\(userId),\(col).in.(\(list))")
            }
            if let lastId { query = query.gt("id", value: lastId) }
            let response: PostgrestResponse<Void> = try await query
                .order("id", ascending: true).limit(page).execute()
            let rows: [JSONObject] = try decoder.decode([JSONObject].self, from: response.data)
            for row in rows { acc.append(T(raw: row)) }
            if rows.count < page { break }
            lastId = rows.last?.str("id")
            if lastId == nil { break }
        }
        return acc
    }

    static func isUUID(_ s: String) -> Bool {
        s.count == 36 && UUID(uuidString: s) != nil
    }

    // MARK: Yazma

    /// Satırın TAMAMI upsert edilir; user_id oturumdan eklenir. Sunucudaki
    /// keep_newer_row (0016) eski damgalı yazmayı sessizce yok sayar.
    public func upsert<T: SyncRecord>(_ record: T, userId: String, now: String) async throws {
        try await upsertRow(T.table, record.rowForWrite(updatedAt: now), userId: userId)
    }

    /// Hazır (damgalı) satırı yaz — çevrimdışı kuyruğun gönderimi de bunu kullanır.
    func upsertRow(_ table: String, _ row: JSONObject, userId: String) async throws {
        var row = row
        row["user_id"] = .string(userId)
        // Boş kimlik referansı ('' geçerli değil) → null (web sanitizeIdRefs)
        for (k, v) in row where k.hasSuffix("Id") && v == .string("") { row[k] = .null }
        try await client.from(table).upsert(row, onConflict: "id", returning: .minimal).execute()
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    func str(_ k: String) -> String? { self[k]?.string }
}
