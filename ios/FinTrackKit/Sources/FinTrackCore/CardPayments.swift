import Foundation

/* ── Kart ödemesi tespiti ──────────────────────────────────────────────────
   Kaynak (birebir): web src/lib/payments/schedule.ts `trFold`,
   `isCardPaymentText`, `assignCardPayments`. Testler card-payments.test.ts ile
   aynı girdiler (CardPaymentsTests.swift).

   Değişmez: belirsiz kayıt (hangi karta ait olduğu bilinmeyen) HİÇBİR karta
   yazılmaz — varsayım yapılmaz.
─────────────────────────────────────────────────────────────────────────── */

public enum CardPayments {
    /// Türkçe duyarsız karşılaştırma: tr-TR küçük harf + aksan düşürme (ı ö ü ş
    /// ç ğ) + boşluk sadeleştirme. (bank-rules'ın foldText'inden farkı: â î û
    /// katlanmaz — web ile aynı.)
    static func trFold(_ text: String) -> String {
        let map: [Character: Character] = ["ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g"]
        let lowered = String(text.lowercased(with: Locale(identifier: "tr_TR")).map { map[$0] ?? $0 })
        return lowered
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "Kredi Kartı Ödemesi" (büyük/küçük harf ve Türkçe karakterden bağımsız;
    /// "kredi karti odeme", "Kredi Kartı Ödemesi - Bonus" gibi varyantlar dahil).
    public static func isCardPaymentText(_ text: String?) -> Bool {
        guard let text, !text.isEmpty else { return false }
        // Ucuz ön süzgeç: katlanmış eşleşme "kred" içermek zorunda (K/k, İ/ı farkı
        // ilk dört harfte yok) — işlemlerin çoğu burada eler, sonuç değişmez
        guard text.range(of: "kred", options: .caseInsensitive) != nil else { return false }
        return trFold(text).range(of: "kredi ?karti? ?odeme", options: .regularExpression) != nil
    }

    /// Hangi işlemin hangi KARTIN ödemesi olduğunu belirler (kart id → işlemler,
    /// girdi sırasıyla). Kurallar — belirsizse işlem hiçbir karta yazılmaz:
    ///  1. Karta yapılan transfer (toAccountId = aktif kart): açıklamadan bağımsız
    ///     o kartın ödemesi. Başka bir hesaba giden transfer kart ödemesi değildir.
    ///  2. Açıklaması/notu "Kredi Kartı Ödemesi" olan kayıtlar:
    ///     • kartın KENDİ hesabına gelir olarak işlenmişse → o kart;
    ///     • kart dışı bir hesaptan gider/transfer ise → açıklamada ya da notta tek
    ///       bir kartın adı geçiyorsa o kart; hiç ad geçmiyor ve tek aktif kart
    ///       varsa o kart; aksi halde atlanır. Kart uygulamaya eklenmeden önceki
    ///       tarihli kayıt o karta yazılmaz.
    /// Borç ödemeleri (debtId) ve sistem satırları (systemKind — mutabakat vb.)
    /// hiçbir zaman kart ödemesi değildir. Ad eşleşmesi arşivli kartları da
    /// kapsar (eski kartın ödemesi yeni karta kaymasın). `accounts` TÜM hesaplar
    /// olmalı (arşivliler dahil) — hedef listesi filtrelenmiş olsa bile.
    public static func assignCardPayments(accounts: [Account], transactions: [Transaction]) -> [String: [Transaction]] {
        let allCards = accounts.filter { $0.type == .credit_card }
        let active = allCards.filter { !$0.isArchived }
        var activeById: [String: Account] = [:]
        for a in active where activeById[a.id] == nil { activeById[a.id] = a }
        let allIds = Set(allCards.map(\.id))
        let names = allCards
            .map { (id: $0.id, name: trFold($0.name)) }
            .filter { $0.name.utf16.count >= 3 }

        var out: [String: [Transaction]] = [:]
        func has(_ s: String?) -> Bool { !(s ?? "").isEmpty }   // JS doğruluk sınaması

        for t in transactions {
            if has(t.debtId) || has(t.systemKind) { continue }

            if t.type == .transfer, let to = t.toAccountId, !to.isEmpty {
                if activeById[to] != nil { out[to, default: []].append(t) }
                continue
            }

            if !isCardPaymentText(t.description) && !isCardPaymentText(t.notes) { continue }

            if allIds.contains(t.accountId) {
                if t.type == .income && activeById[t.accountId] != nil { out[t.accountId, default: []].append(t) }
                continue
            }
            if t.type == .income { continue }   // nakit hesaba giren para kart ödemesi değildir

            let hay = trFold("\(t.description) \(t.notes ?? "")")
            let named = names.filter { hay.contains($0.name) }
            var owner: Account?
            if named.count == 1 { owner = activeById[named[0].id] }
            else if named.isEmpty && active.count == 1 { owner = active[0] }
            guard let owner else { continue }
            if !owner.createdAt.isEmpty && t.date.prefix(10) < owner.createdAt.prefix(10) { continue }
            out[owner.id, default: []].append(t)
        }
        return out
    }
}
