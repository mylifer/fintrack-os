import Foundation

/* ── Faiz geliri stopajı — web src/lib/utils/interest-tax.ts karşılığı ──────
   Faiz kategorisiyle girilen gelirde bankanın kestiği stopaj ayrı bir VERGİ
   gideri olarak yazılır:

     faiz geliri (brüt, Faiz kategorisi)   +brüt
     stopaj gideri (Vergi, alıcı İTC)      −stopaj
     hesaba etkisi                          net  (= bankanın yatırdığı)

   Bağ: stopaj satırının kimliği faiz satırının kimliğinden TÜRETİLİR
   (taxId) — web ile aynı formül, iki platform aynı satırı bulur. Silme
   ikisini birlikte siler, düzenleme stopajı yeniden hesaplar.
─────────────────────────────────────────────────────────────────────────── */

public enum InterestTax {
    public static let suffix = "stopajı"
    public static let defaultRate = Deposit.defaultTax

    public enum Mode: String, Sendable, CaseIterable { case net, gross }

    public struct Split: Equatable, Sendable {
        public var gross: Double
        public var tax: Double
        public var net: Double
    }

    /// Faiz satırına bağlı stopaj gider satırının kimliği (web interestTaxId).
    public static func taxId(for interestTxId: String) -> String {
        DeterministicID.uuid("interest-tax:\(interestTxId)")
    }

    /// Adında (ya da bir üst kategorisinin adında) "faiz" geçen GELİR kategorisi.
    public static func isInterestCategory(_ categoryId: String?, _ categories: [Category]) -> Bool {
        guard let categoryId, var cur = categories.first(where: { $0.id == categoryId }),
              cur.scope == .income else { return false }
        for _ in 0..<5 {
            if BankRules.foldText(cur.name).contains("faiz") { return true }
            guard let p = cur.parentId, let parent = categories.first(where: { $0.id == p }) else { return false }
            cur = parent
        }
        return false
    }

    /// Girilen tutardan brüt / stopaj / net.
    /// - gross: stopaj = brüt × oran (kuruşa yuvarlı), net = brüt − stopaj.
    /// - net: bankanın yatırdığı tutar girildi; brüt, stopajı kesilince TAM bu
    ///   neti veren tutardır — hesaba etki girilen tutarla kuruşu kuruşuna aynı.
    public static func split(_ amount: Double, ratePct: Double, mode: Mode) -> Split {
        let amt = Money.toMinor(max(0, amount))
        let r = min(max(ratePct, 0), 99.99) / 100
        func round(_ x: Double) -> Int { Money.safeInt(Money.jsRound(x)) }
        if mode == .gross {
            let tax = round(Double(amt) * r)
            return Split(gross: Money.toMajor(amt), tax: Money.toMajor(tax), net: Money.toMajor(amt - tax))
        }
        let approx = round(Double(amt) / (1 - r))
        var gross = approx
        for g in [approx, approx - 1, approx + 1] where g - round(Double(g) * r) == amt {
            gross = g
            break
        }
        return Split(gross: Money.toMajor(gross), tax: Money.toMajor(gross - amt), net: Money.toMajor(amt))
    }

    /// Kayıtlı faiz + stopaj satırından oran (düzenleme formu için).
    public static func impliedRate(gross: Double, tax: Double) -> Double {
        guard gross > 0 else { return 0 }
        return Money.jsRound(tax / gross * 10000) / 100
    }

    /// Silinecek satırlara, içlerindeki faiz satırlarının stopaj satırlarını ekler.
    public static func withLinkedTax(_ group: [Transaction], all: [Transaction]) -> [Transaction] {
        var ids = Set(group.map(\.id))
        var out = group
        for t in group where t.type == .income {
            let id = taxId(for: t.id)
            if !ids.contains(id), let tax = all.first(where: { $0.id == id && $0.isLive }) {
                ids.insert(id)
                out.append(tax)
            }
        }
        return out
    }

    /// Stopaj gideri kategorisi: sistemdeki "Vergi", yoksa adında vergi geçen ilk gider kategorisi.
    public static func taxCategoryId(_ categories: [Category]) -> String? {
        let live = categories.filter { $0.scope == .expense && !$0.isArchived }
        return (live.first { $0.raw.flag("isSystem") == true && $0.name == "Vergi" }
            ?? live.first { BankRules.foldText($0.name).contains("vergi") })?.id
    }

    /// Stopaj satırı (web TransactionFormModal addTx(interestTaxId(...))).
    public static func makeTaxRow(interest: Transaction, tax: Double, categories: [Category],
                                  recipientId: String?, fx: FX, now: String) -> Transaction {
        var raw: JSONObject = [
            "id": .string(taxId(for: interest.id)),
            "type": "expense",
            "amount": .number(tax),
            "currency": .string(interest.currency.rawValue),
            "date": .string(String(interest.date.prefix(10))),
            "accountId": .string(interest.accountId),
            "categoryId": JSONValue(taxCategoryId(categories)),
            "recipientId": JSONValue(recipientId),
            "description": .string(taxDescription(interest.description)),
            "isInstallment": .bool(false),
            "createdAt": .string(now),
            "updatedAt": .string(now),
            "deleted_at": .null,
            "workspaceId": JSONValue(interest.workspaceId),
        ]
        // Web withBase: kur yoksa TL değeri yazılmaz. Onay durumu faiz satırıyla aynı
        // (gelecek tarihli yeni satır 'pending' doğar)
        if let snap = fx.baseSnapshot(tax, interest.currency) { raw["amountTry"] = .number(snap) }
        if let s = interest.approvalStatus { raw["approvalStatus"] = .string(s.rawValue) }
        return Transaction(raw: raw)
    }

    public static func taxDescription(_ interestDescription: String) -> String {
        "\(interestDescription.trimmingCharacters(in: .whitespacesAndNewlines)) \(suffix)"
    }
}
