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
        if type == .transfer {
            guard let to = toAccountId else { return "Hedef hesabı seçin." }
            if to == accountId { return "Kaynak ve hedef hesap aynı olamaz." }
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
                        workspaceId: String?, fx: FX, now: String, today: String = DateUtil.today()) -> Transaction {
        let day = DateUtil.day(date)
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
        return Transaction(raw: raw)
    }

    /// Var olan işlemin düzenlenmiş hali. Para birimi hesaptan gelir (web formu gibi).
    public func applying(to t: Transaction, account: Account, fx: FX) -> Transaction {
        var out = t
        out.type = type
        out.amount = amount
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
        return out
    }
}

extension Transaction {
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
