import Foundation

/// Hızlı ekleme / düzenleme formunun durumu ve yazılacak satıra dönüşümü.
/// Web transactions.store'daki yazma kuralları burada uygulanır:
///   • withBase: amountTry = kurla TRY değeri; kur yoksa alan boş (ham değer damgalanmaz)
///   • withApproval: YENİ ve gelecek tarihli işlem 'pending' doğar
///   • düzenlemede tutar/para birimi değişirse amountTry yeniden hesaplanır
public struct TransactionDraft: Equatable, Sendable {
    public var type: TransactionType = .expense
    public var amountText: String = ""
    public var date: Date = Date()
    public var accountId: String?
    public var toAccountId: String?
    public var categoryId: String?
    public var description: String = ""
    public var notes: String = ""
    /// Gider için "abonelik" etiketi (web ödeme türü segmenti "Abonelik")
    public var isSubscription = false
    /// Abonelik dışındaki etiketler (web etiket alanı); yazmada `Tags.dedupe`
    public var tags: [String] = []
    /// Web kişileri (people): aile üyesi ve alıcı; transferde yazılmaz
    public var familyMemberId: String?
    public var recipientId: String?

    /// Transferin hedefi (web "Hesap | Borç | Diğer Alan")
    public enum TransferTarget: String, Sendable, CaseIterable { case account, debt, workspace }
    public var transferTarget: TransferTarget = .account
    /// Borç bağı: transfer + .debt → borç ödemesi; gelir + isCollection → alacak tahsilatı
    public var debtId: String?
    /// Gelir sekmesinde "Gelir | Alacak" (web isCollection)
    public var isCollection = false
    /// Diğer çalışma alanına transfer: hedef alan; hedef hesap `toAccountId`
    public var targetWorkspaceId: String?
    /// Diğer alanda borç öde (web crossWsDebt) ve ödenecek borç
    public var crossPayDebt = false
    public var targetDebtId: String?
    /// Faiz stopajı: girilen tutar net mi brüt mü; oran metni (nil = hesabın/varsayılan)
    public var interestMode: InterestTax.Mode = .net
    public var interestRateText: String?
    /// Kategori bölme (web categorySplits): nil = bölünmemiş. Tutarlar POZİTİF
    /// tutulur; yazarken işlemin işaretini alır. En az 2 pay.
    public var splits: [CategorySplit]?

    public init() {}

    public init(editing t: Transaction) {
        type = t.type
        amountText = Fmt.amountInput(t.amount)
        date = DateUtil.parseDay(t.date) ?? Date()
        accountId = t.accountId
        toAccountId = t.toAccountId
        categoryId = t.categoryId
        description = t.description
        notes = t.notes ?? ""
        isSubscription = Subscriptions.hasSubscriptionTag(t.tags)
        tags = (t.tags ?? []).filter { !Subscriptions.isSubscriptionTag($0) }
        familyMemberId = t.familyMemberId
        recipientId = t.recipientId
        if t.isPlainDebtPayment && t.toAccountId == nil {
            type = .transfer
            transferTarget = .debt
            debtId = t.debtId
        } else if t.isPlainDebtCollection {
            isCollection = true
            debtId = t.debtId
            categoryId = nil
        }
        // Düzenlemede kayıtlı faiz satırı BRÜTTÜR (web)
        interestMode = .gross
        if let sp = t.categorySplits, sp.count > 1 {
            splits = sp.map { CategorySplit(categoryId: $0.categoryId, amount: abs($0.amount)) }
        }
    }

    /// Bölünmüş ve geçerli payların kaydı (işaretli); bölünmemişse nil
    func splitsForWrite(amount: Double) -> [CategorySplit]? {
        guard type != .transfer, !isDebtCollection, let s = splits, s.count >= 2 else { return nil }
        let sign: Double = amount < 0 ? -1 : 1
        return s.map { CategorySplit(categoryId: $0.categoryId, amount: $0.amount * sign) }
    }

    /// En büyük payın kategorisi (web primarySplitCategoryId)
    public static func primaryCategory(_ s: [CategorySplit]) -> String? {
        guard var best = s.first else { return nil }
        for x in s where abs(Money.toMinor(x.amount)) > abs(Money.toMinor(best.amount)) { best = x }
        return best.categoryId.isEmpty ? nil : best.categoryId
    }

    /// Kalan (bölünmemiş) tutar: |tutar| − payların toplamı
    public var splitRemainder: Double {
        Money.sub(abs(amount), Money.sum((splits ?? []).map(\.amount)))
    }

    static func splitsJSON(_ s: [CategorySplit]) -> JSONValue {
        .array(s.map { .object(["categoryId": .string($0.categoryId), "amount": .number($0.amount)]) })
    }

    /// Borç ödemesi (transfer → borç)
    public var isDebtPayment: Bool { type == .transfer && transferTarget == .debt }
    /// Alacak tahsilatı (gelir → alacak)
    public var isDebtCollection: Bool { type == .income && isCollection }
    /// Başka çalışma alanına transfer
    public var isCrossWorkspace: Bool { type == .transfer && transferTarget == .workspace }
    /// Yazılacak borç bağı (yoksa nil)
    public var linkedDebtId: String? { isDebtPayment || isDebtCollection ? debtId : nil }

    /// Stopaj oranı: elle girilen, yoksa hesabın mevduat stopajı, yoksa %17,5.
    public func interestRate(account: Account?) -> Double {
        if let t = interestRateText { return Fmt.parseAmount(t) }
        return account?.raw.num("depositTaxPct") ?? InterestTax.defaultRate
    }

    public func interestSplit(account: Account?) -> InterestTax.Split {
        InterestTax.split(amount, ratePct: interestRate(account: account), mode: interestMode)
    }

    /// Yazılacak etiket listesi: temizlenmiş etiketler + abonelik. Abonelik
    /// anahtarı yalnız giderde görünür: yeni satırda yalnız gidere yazılır;
    /// düzenlemede web'in gelir/transfer satırına koyduğu etiket korunur.
    func tagsForWrite(hadSubscription: Bool = false) -> [String] {
        let others = Tags.dedupe(tags.filter { !Subscriptions.isSubscriptionTag($0) })
        let keepSub = isSubscription && (type == .expense || hadSubscription)
        return others + (keepSub ? [Subscriptions.tag] : [])
    }

    public var amount: Double { Fmt.parseAmount(amountText) }

    /// Kaydedilebilir mi? Nedenini döner (nil = geçerli).
    public func validationError() -> String? {
        if amount == 0 { return "Tutar girin." }
        guard let accountId else { return "Hesap seçin." }
        if isDebtPayment {
            if debtId == nil { return "Borç seçin." }
            if amount < 0 { return "Tutar girin." }
        } else if isCrossWorkspace {
            if targetWorkspaceId == nil { return "Çalışma alanı seçin." }
            if crossPayDebt && targetDebtId == nil { return "Borç seçin." }
            if toAccountId == nil { return crossPayDebt ? "Ödemenin geçeceği hesabı seçin." : "Hedef hesabı seçin." }
            if amount < 0 { return "Tutar girin." }
            if description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Açıklama girin." }
        } else if type == .transfer {
            guard let to = toAccountId else { return "Hedef hesabı seçin." }
            if to == accountId { return "Kaynak ve hedef hesap aynı olamaz." }
        }
        if isDebtCollection {
            if debtId == nil { return "Alacak seçin." }
            if amount < 0 { return "Tutar girin." }
        }
        if type != .transfer && !isDebtCollection, let sp = splits {
            if sp.count < 2 { return "En az iki pay girin ya da bölmeyi kaldırın." }
            if sp.contains(where: { $0.categoryId.isEmpty }) { return "Her pay için kategori seçin." }
            if Set(sp.map(\.categoryId)).count != sp.count { return "Aynı kategori iki kez seçilemez." }
            if sp.contains(where: { $0.amount < 0.01 }) { return "Her payın tutarı girilmeli." }
            if Money.toMinor(Money.sum(sp.map(\.amount))) != Money.toMinor(abs(amount)) {
                return "Payların toplamı tutara eşit olmalı (kalan \(Fmt.amountInput(splitRemainder)))."
            }
        }
        return nil
    }

    private var descriptionOrDefault: String {
        let d = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return d
    }

    private var notesOrNil: String? {
        let n = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? nil : n
    }

    /// Yeni işlem satırı. `now` ISO damgası (createdAt/updatedAt).
    public func makeNew(id: String = UUID().uuidString.lowercased(), account: Account,
                        workspaceId: String?, fx: FX, now: String, today: String = DateUtil.today(),
                        amount override: Double? = nil) -> Transaction {
        let day = DateUtil.day(date)
        let amount = override ?? self.amount
        let debtLink = linkedDebtId
        var raw: JSONObject = [
            "id": .string(id),
            "type": .string(type.rawValue),
            "amount": .number(amount),
            "currency": .string(account.currency.rawValue),
            "date": .string(day),
            "accountId": .string(account.id),
            "toAccountId": JSONValue(type == .transfer ? toAccountId : nil),
            "categoryId": JSONValue(type == .transfer ? nil : categoryId),
            "description": .string(descriptionOrDefault),
            "notes": JSONValue(notesOrNil),
            "tags": .array(tagsForWrite().map { .string($0) }),
            "familyMemberId": JSONValue(type == .transfer ? nil : familyMemberId),
            "recipientId": JSONValue(type == .transfer ? nil : recipientId),
            "isInstallment": .bool(false),
            "createdAt": .string(now),
            "updatedAt": .string(now),
            "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        if let snap = fx.baseSnapshot(amount, account.currency) { raw["amountTry"] = .number(snap) }
        if day > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
        if let sp = splitsForWrite(amount: amount) {
            raw["categorySplits"] = Self.splitsJSON(sp)
            raw["categoryId"] = JSONValue(Self.primaryCategory(sp))
        }
        if let debtLink {
            // Borç ödemesi: tek bacaklı transfer; tahsilat: kategorisiz 🤝 gelir (web)
            raw["debtId"] = .string(debtLink)
            raw["toAccountId"] = .null
            raw["categoryId"] = .null
            if isDebtCollection {
                raw["icon"] = .string(Calc.debtCollectionIcon)
            } else {
                raw["familyMemberId"] = .null
                raw["recipientId"] = .null
            }
        }
        return Transaction(raw: raw)
    }

    /// Var olan işlemin düzenlenmiş hali. Para birimi hesaptan gelir (web formu gibi).
    public func applying(to t: Transaction, account: Account, fx: FX, amount override: Double? = nil) -> Transaction {
        var out = t
        out.type = type
        out.amount = override ?? amount
        out.currency = account.currency
        out.date = DateUtil.day(date)
        out.accountId = account.id
        out.toAccountId = type == .transfer ? toAccountId : nil
        out.categoryId = type == .transfer ? nil : categoryId
        out.description = descriptionOrDefault
        out.notes = notesOrNil
        // Etiketlere dokunulmadıysa ham liste aynen kalır (web'in yazdığı biçim korunur)
        let hadSub = Subscriptions.hasSubscriptionTag(t.tags)
        let wantsSub = isSubscription && (type == .expense || hadSub)
        let originalOthers = (t.tags ?? []).filter { !Subscriptions.isSubscriptionTag($0) }
        if wantsSub != hadSub || tags != originalOthers {
            out.raw["tags"] = .array(tagsForWrite(hadSubscription: hadSub).map { .string($0) })
        }
        // Kişiler: web formu gibi transferde boş; değişmediyse ham satıra dokunulmaz
        let fam = type == .transfer ? nil : familyMemberId
        let rec = type == .transfer ? nil : recipientId
        if fam != t.familyMemberId { out.raw["familyMemberId"] = JSONValue(fam) }
        if rec != t.recipientId { out.raw["recipientId"] = JSONValue(rec) }
        // Kuruş düzeyinde kıyas: yalnız açıklama düzenlenince eski kayıttaki
        // kayan nokta gürültüsü yüzünden tarihî TRY değeri değişmesin
        if Money.toMinor(t.amount) != Money.toMinor(out.amount) || t.currency != out.currency {
            out.amountTry = fx.baseSnapshot(out.amount, out.currency)
        }
        // Kategori bölme: paylar işaretli yazılır, ana kategori en büyük pay
        if let sp = splitsForWrite(amount: out.amount) {
            out.raw["categorySplits"] = Self.splitsJSON(sp)
            out.categoryId = Self.primaryCategory(sp)
        } else if (t.categorySplits?.count ?? 0) > 0 {
            out.raw["categorySplits"] = .null
        }
        // Borç bağı (web collectionFields): ödeme/tahsilat ↔ sıradan işlem
        if let link = linkedDebtId {
            out.raw["debtId"] = .string(link)
            out.toAccountId = nil
            out.categoryId = nil
            out.raw["icon"] = isDebtCollection ? .string(Calc.debtCollectionIcon) : .null
            if isDebtPayment { out.raw["familyMemberId"] = .null; out.raw["recipientId"] = .null }
        } else if t.isPlainDebtLink {
            out.raw["debtId"] = .null
            if t.isPlainDebtCollection { out.raw["icon"] = .null }
        }
        return out.rebuilt()
    }
}

extension Transaction {
    /// Ham satırı değiştirilmiş kayıt: değişkenler ham satıra yazılır, salt okunur
    /// alanlar (debtId, icon …) ham satırdan yeniden okunur.
    public func rebuilt() -> Transaction {
        var r = raw
        for (k, v) in ownedColumns() { r[k] = v }
        return Transaction(raw: r)
    }

    /// Silme = tombstone: deleted_at damgalanır, satır yerinde kalır.
    public func tombstoned(at now: String) -> Transaction {
        var out = self
        out.raw["deleted_at"] = .string(now)
        return out
    }
}

extension Transaction {
    /// Onay (web NotificationPanel.approveTx): yalnız approvalStatus + approvedAt
    /// (+ updatedAt yazmada). Tarih DEĞİŞMEZ — erken onaylanan gelecek satır
    /// tarihinde bakiyeye girer. Yan etkisi yok; bağlı satırlar da onaylanabilir.
    public func approved(at now: String) -> Transaction {
        var out = self
        out.approvalStatus = .approved
        out.approvedAt = now
        return out
    }
}
