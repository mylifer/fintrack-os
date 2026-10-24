import Foundation

/* ── Yatırım alım / satımı — web src/store/investment.store.ts ──────────────
   Yatırım satırı (investment_transactions) + hesaba bağlı defter satırları:
     • alım:  hesaptan gider "N Gr Altın Alımı" (ikonlu → akışa girmez)
     • satış: hesaba gelir "N Gr Altın Satışı" (maliyet kadar, ikonlu), kâr
       varsa "… Satış Kârı" gelir / zarar varsa "… Satış Zararı" gider (ikonlu,
       gerçekleşen K/Z), TEFAS fonunda stopaj açıksa "… Satış Stopajı" gider.
   Defter satırları HESABIN para biriminde yazılır (TL tutar kurla çevrilir;
   kur yoksa hiçbir şey yazılmaz). Maliyet bazı SATIŞ ANINDAKİ ortalama maliyet.
   Düzenleme: eski bağlı satırlar silinip yenileri yazılır (web updateTransaction).
─────────────────────────────────────────────────────────────────────────── */

/// TEFAS fon stopajı ayarı (web settings.store fundTax*; cihazda saklanır).
public struct FundTaxConfig: Codable, Equatable, Sendable {
    public var enabled = false
    public var defaultRate = 0.0
    /// Fon kodu → oran (%); varsayılanı ezer (0 dahil)
    public var rates: [String: Double] = [:]

    public init(enabled: Bool = false, defaultRate: Double = 0, rates: [String: Double] = [:]) {
        self.enabled = enabled; self.defaultRate = defaultRate; self.rates = rates
    }

    static func clamp(_ r: Double) -> Double { r.isFinite ? min(100, max(0, r)) : 0 }

    /// Bu varlığa uygulanacak stopaj oranı (%). TEFAS dışında 0.
    public func rate(_ asset: String) -> Double {
        guard enabled, Asset.kind(asset) == .fund else { return 0 }
        return Self.clamp(rates[Asset.code(asset)] ?? defaultRate)
    }

    /// Kâr üzerinden stopaj — zararda 0, kuruşa yuvarlı (web taxOnGain).
    public static func taxOnGain(_ gain: Double, rate: Double) -> Double {
        guard gain > 0, rate > 0 else { return 0 }
        return Money.jsRound(gain * rate) / 100
    }
}

extension InvestmentTransaction {
    public var sourceAccountId: String? { raw.str("sourceAccountId") }
    public var targetAccountId: String? { raw.str("targetAccountId") }
    public var linkedTransactionId: String? { raw.str("linkedTransactionId") }
    public var pnlLinkedTransactionId: String? { raw.str("pnlLinkedTransactionId") }
    public var taxLinkedTransactionId: String? { raw.str("taxLinkedTransactionId") }

    public func tombstoned(at now: String) -> InvestmentTransaction {
        var r = raw
        r["deleted_at"] = .string(now)
        return InvestmentTransaction(raw: r)
    }
}

public enum InvestmentTrade {
    public struct Input: Equatable, Sendable {
        public var type: String          // 'buy' | 'sell'
        public var asset: String
        public var quantity: Double
        public var pricePerUnit: Double  // TL
        public var date: String
        public var accountId: String?    // alımda kaynak, satışta hedef
        public var note: String?

        public init(type: String, asset: String, quantity: Double, pricePerUnit: Double, date: String,
                    accountId: String?, note: String?) {
            self.type = type; self.asset = asset; self.quantity = quantity; self.pricePerUnit = pricePerUnit
            self.date = date; self.accountId = accountId; self.note = note
        }

        public var total: Double { quantity * pricePerUnit }
    }

    public enum TradeError: LocalizedError, Equatable {
        case quantity, price, sellExceeds(Double), noRate(String)
        public var errorDescription: String? {
            switch self {
            case .quantity: "Miktar girin."
            case .price: "Birim fiyat girin."
            case .sellExceeds(let max): "Elde \(Fmt.quantity(max)) var; daha fazlası satılamaz."
            case .noRate(let c): "\(c) kuru henüz yüklenmedi — hesaba yazılacak tutar çevrilemiyor. Biraz sonra tekrar deneyin."
            }
        }
    }

    /// Defter satırı işareti (isInvestmentPrincipal ikona bakar — boş olmamalı)
    public static func icon(_ asset: String) -> String {
        switch Asset.kind(asset) {
        case .fund: "F"
        case .stock: "H"
        case .crypto: "₿"
        case .gold: "Au"
        case .currency: ["USD": "$", "EUR": "€", "GBP": "£"][asset] ?? "$"
        }
    }

    /// Web fmtQty: tam sayıda gruplu, küsuratta en çok 4 hane (tr-TR)
    public static func qtyText(_ q: Double) -> String { Fmt.quantity(q) }

    public static func buyDescription(_ asset: String, _ q: Double) -> String { "\(qtyText(q)) \(Asset.label(asset)) Alımı" }
    public static func sellDescription(_ asset: String, _ q: Double) -> String { "\(qtyText(q)) \(Asset.label(asset)) Satışı" }

    /// Satış anındaki ortalama maliyet (web avgCostAt): o andan sonraki işlemler sayılmaz.
    public static func avgCostAt(_ txs: [InvestmentTransaction], asset: String, date: String, createdAt: String,
                                 excluding: String? = nil) -> Double {
        var qty = 0.0, cost = 0.0
        let sorted = txs.filter(\.isLive)
            .sorted { $0.date != $1.date ? $0.date < $1.date : $0.createdAt < $1.createdAt }
        for t in sorted {
            if t.asset != asset || t.id == excluding { continue }
            if t.date > date || (t.date == date && t.createdAt >= createdAt) { break }
            if t.type == "buy" {
                cost += t.quantity * t.pricePerUnit
                qty += t.quantity
            } else {
                let avg = qty > 0 ? cost / qty : 0
                qty = max(0, qty - t.quantity)
                cost = qty * avg
            }
        }
        return qty > 0 ? cost / qty : 0
    }

    /// Elde kalan miktar (satış sınırı); düzenlenen satış kendi miktarı kadar geri eklenir.
    public static func held(_ txs: [InvestmentTransaction], asset: String, excluding: String? = nil) -> Double {
        let h = Portfolio.holdings(txs.filter { $0.isLive && $0.id != excluding }, prices: PriceBook())
        return h.first { $0.asset == asset }?.quantity ?? 0
    }

    /// Düzenleme/silmede kaldırılacak eski bağlı defter satırları (web cleanLinkedTxs +
    /// sellCleanupTxIds): önce kimlik bağları, yoksa açıklama + tarih eşleşmesi.
    public static func linkedLedgerIds(_ t: InvestmentTransaction, in txs: [Transaction]) -> [String] {
        let live = txs.filter(\.isLive)
        let label = Asset.label(t.asset)
        if t.type == "buy" {
            guard let acc = t.sourceAccountId else { return [] }
            if let id = t.linkedTransactionId { return [id] }
            return live.filter {
                $0.type == .expense && $0.accountId == acc && $0.date == t.date
                    && $0.description.contains(label) && $0.description.contains("Alım")
            }.map(\.id)
        }
        guard let acc = t.targetAccountId else { return [] }
        if let sale = t.linkedTransactionId {
            var ids = [sale]
            if let p = t.pnlLinkedTransactionId { ids.append(p) }
            else if let p = live.first(where: {
                $0.accountId == acc && $0.date == t.date
                    && ($0.description == "\(label) Satış Kârı" || $0.description == "\(label) Satış Zararı")
            }) { ids.append(p.id) }
            if let x = t.taxLinkedTransactionId { ids.append(x) }
            return ids
        }
        return live.filter {
            ($0.type == .income || $0.type == .expense) && $0.accountId == acc && $0.date == t.date
                && $0.description.contains(label) && $0.description.contains("Satış")
        }.map(\.id)
    }

    public struct Output: Sendable {
        public var investment: InvestmentTransaction
        public var ledger: [Transaction]
    }

    /// Yazılacak yatırım satırı ve bağlı defter satırları.
    /// `ids`: [yatırım, satış/alım, K/Z, stopaj] — tekrar denemede aynı satırlar.
    public static func make(_ input: Input, editing: InvestmentTransaction?, account: Account?,
                            investments: [InvestmentTransaction], fundTax: FundTaxConfig,
                            categories: [Category], fx: FX, workspaceId: String?, now: String,
                            ids: [String], today: String = DateUtil.today()) throws -> Output {
        guard input.quantity > 0 else { throw TradeError.quantity }
        guard input.pricePerUnit > 0 else { throw TradeError.price }
        if input.type == "sell" {
            let max = held(investments, asset: input.asset, excluding: editing?.id)
            if input.quantity > max + 0.0000001 { throw TradeError.sellExceeds(max) }
        }
        if let a = account, a.currency != .TRY, fx.rate(a.currency) == nil { throw TradeError.noRate(a.currency.rawValue) }

        let createdAt = editing?.createdAt.isEmpty == false ? editing!.createdAt : now
        let date = String(input.date.prefix(10))
        let ws = editing?.workspaceId ?? workspaceId

        func money(_ amountTry: Double) -> (amount: Double, currency: CurrencyCode) {
            guard let a = account, a.currency != .TRY else { return (amountTry, .TRY) }
            return (fx.fromBaseTry(amountTry, a.currency), a.currency)
        }
        func row(_ id: String, _ type: TransactionType, _ amountTry: Double, _ desc: String,
                 icon: String?, category: String? = nil) -> Transaction {
            let m = money(amountTry)
            var raw: JSONObject = [
                "id": .string(id), "type": .string(type.rawValue), "amount": .number(m.amount),
                "currency": .string(m.currency.rawValue), "date": .string(date),
                "accountId": .string(account!.id), "icon": JSONValue(icon), "categoryId": JSONValue(category),
                "description": .string(desc), "isInstallment": .bool(false),
                "createdAt": .string(createdAt), "updatedAt": .string(now), "deleted_at": .null,
                "workspaceId": JSONValue(account?.workspaceId ?? ws),
            ]
            if let snap = fx.baseSnapshot(m.amount, m.currency) { raw["amountTry"] = .number(snap) }
            if date > today { raw["approvalStatus"] = .string(ApprovalStatus.pending.rawValue) }
            return Transaction(raw: raw)
        }

        var ledger: [Transaction] = []
        var linked: String?, pnlId: String?, taxId: String?
        let total = input.total
        let ic = icon(input.asset)
        if account != nil {
            if input.type == "buy" {
                ledger.append(row(ids[1], .expense, total, buyDescription(input.asset, input.quantity), icon: ic))
                linked = ids[1]
            } else {
                let cost = input.quantity * avgCostAt(investments, asset: input.asset, date: date,
                                                      createdAt: createdAt, excluding: editing?.id)
                let hasCost = cost > 0.001
                let sale = hasCost ? cost : total
                let pnl = hasCost ? total - cost : 0
                ledger.append(row(ids[1], .income, sale, sellDescription(input.asset, input.quantity), icon: ic))
                linked = ids[1]
                let label = Asset.label(input.asset)
                if hasCost && money(abs(pnl)).amount >= 0.01 {
                    ledger.append(row(ids[2], pnl > 0 ? .income : .expense, abs(pnl),
                                      pnl > 0 ? "\(label) Satış Kârı" : "\(label) Satış Zararı", icon: ic))
                    pnlId = ids[2]
                }
                let tax = hasCost ? FundTaxConfig.taxOnGain(pnl, rate: fundTax.rate(input.asset)) : 0
                if money(tax).amount >= 0.01 {
                    let vergi = categories.first {
                        $0.raw.flag("isSystem") == true && $0.scope == .expense && $0.name == "Vergi" && !$0.isArchived
                    }?.id
                    ledger.append(row(ids[3], .expense, tax, "\(label) Satış Stopajı", icon: ic, category: vergi))
                    taxId = ids[3]
                }
            }
        }

        var raw = editing?.raw ?? [
            "id": .string(ids[0]), "createdAt": .string(createdAt), "deleted_at": .null,
            "workspaceId": JSONValue(workspaceId),
        ]
        raw["type"] = .string(input.type)
        raw["asset"] = .string(input.asset)
        raw["quantity"] = .number(input.quantity)
        raw["pricePerUnit"] = .number(input.pricePerUnit)
        raw["date"] = .string(date)
        raw["sourceAccountId"] = input.type == "buy" ? JSONValue(account?.id) : .null
        raw["targetAccountId"] = input.type == "sell" ? JSONValue(account?.id) : .null
        let note = input.note?.trimmingCharacters(in: .whitespacesAndNewlines)
        raw["note"] = note?.isEmpty == false ? .string(note!) : .null
        raw["linkedTransactionId"] = JSONValue(linked)
        raw["pnlLinkedTransactionId"] = JSONValue(pnlId)
        raw["taxLinkedTransactionId"] = JSONValue(taxId)
        return Output(investment: InvestmentTransaction(raw: raw), ledger: ledger)
    }
}
