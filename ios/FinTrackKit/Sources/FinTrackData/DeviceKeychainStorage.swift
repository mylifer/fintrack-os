import Foundation
import Security
import Supabase

/// Oturum anahtarlarının (erişim + yenileme belirteci) deposu. supabase-swift'in
/// varsayılanı `AfterFirstUnlock` ile yazar: öğe şifreli cihaz yedeğine girer ve
/// başka bir telefona geri yüklenebilir. Burada `ThisDeviceOnly` — belirteç bu
/// cihazdan çıkmaz. Eski depodaki oturum ilk okumada buraya taşınır (kullanıcı
/// güncellemeden sonra yeniden giriş yapmak zorunda kalmaz).
struct DeviceKeychainStorage: AuthLocalStorage {
    private let service = "com.mylifer.fintrack.auth"
    private let legacy = KeychainLocalStorage()

    func store(key: String, value: Data) throws {
        let query = base(key)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = value
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            try check(SecItemAdd(add as CFDictionary, nil))
        } else {
            try check(status)
        }
    }

    func retrieve(key: String) throws -> Data? {
        var query = base(key)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecSuccess { return out as? Data }
        guard status == errSecItemNotFound else { try check(status); return nil }

        // Eski (yedeğe giren) depodan tek seferlik taşıma
        guard let old = try? legacy.retrieve(key: key) else { return nil }
        try store(key: key, value: old)
        try? legacy.remove(key: key)
        return old
    }

    func remove(key: String) throws {
        let status = SecItemDelete(base(key) as CFDictionary)
        try? legacy.remove(key: key)
        if status != errSecItemNotFound { try check(status) }
    }

    private func base(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key]
    }

    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}
