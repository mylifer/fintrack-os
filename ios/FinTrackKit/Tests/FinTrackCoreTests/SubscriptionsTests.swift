import Testing
@testable import FinTrackCore

/* Web src/lib/utils/subscriptions.test.ts ile AYNI girdiler ve beklenen sonuçlar.
   Kurlar: usdTry 34.5, eurTry 37, gbpTry 43 (CalculationsTests.swift'teki `fx`).
   Biri değişirse diğeri de değişmeli. */

/// Web `tx()` kurucusu: yalnızca toplayıcıların okuduğu alanlar önemli.
private func sub(_ o: JSONObject = [:]) -> Transaction {
    var raw: JSONObject = [
        "id": "t", "type": "expense", "amount": 100, "currency": "TRY",
        "date": "2026-07-05", "accountId": "a", "description": "Netflix",
        "tags": .array([.string(Subscriptions.tag)]), "isInstallment": false,
        "createdAt": "2026-07-05T00:00:00Z", "updatedAt": "2026-07-05T00:00:00Z",
    ]
    for (k, v) in o { raw[k] = v }
    return tx(raw)
}

private func tags(_ t: String...) -> JSONValue { .array(t.map { .string($0) }) }

@Suite("abonelik — isSubscriptionTx")
struct SubscriptionTxTests {
    @Test func taggedExpenseIsSubscription() {
        #expect(Subscriptions.isSubscriptionTx(sub()))
    }
    @Test func taggedIncomeIsNot() {
        #expect(!Subscriptions.isSubscriptionTx(sub(["type": "income"])))
    }
    @Test func untaggedExpenseIsNot() {
        #expect(!Subscriptions.isSubscriptionTx(sub(["tags": tags()])))
        #expect(!Subscriptions.isSubscriptionTx(sub(["tags": nil])))
    }
    @Test func tagMatchIsCaseAndDiacriticInsensitive() {
        #expect(Subscriptions.isSubscriptionTx(sub(["tags": tags("Abonelik")])))
        #expect(Subscriptions.isSubscriptionTx(sub(["tags": tags("ABONELİK")])))
        #expect(Subscriptions.isSubscriptionTx(sub(["tags": tags("diger", "abonelik")])))
    }
}

@Suite("abonelik — detectBrand")
struct DetectBrandTests {
    @Test func recognizesNetflixAndSpotify() {
        #expect(Subscriptions.detectBrand("Netflix Türkiye")?.key == "netflix")
        #expect(Subscriptions.detectBrand("SPOTIFY Premium")?.key == "spotify")
    }
    @Test func diacriticInsensitive() {
        #expect(Subscriptions.detectBrand("NETFLİX")?.key == "netflix")
    }
    @Test func prefersLongerKeyword() {
        #expect(Subscriptions.detectBrand("YouTube Music")?.key == "youtubemusic")
        #expect(Subscriptions.detectBrand("Apple Music")?.key == "apple")
    }
    @Test func nullForUnknownMerchant() {
        #expect(Subscriptions.detectBrand("Bakkal Ahmet") == nil)
        #expect(Subscriptions.detectBrand("", nil, nil) == nil)
    }
}

@Suite("abonelik — gruplama")
struct GroupSubscriptionsTests {
    @Test func collapsesTwoNetflixCharges() {
        let groups = Subscriptions.groupSubscriptions([
            sub(["id": "1", "amount": 149.99, "date": "2026-06-05"]),
            sub(["id": "2", "amount": 199.99, "date": "2026-07-05"]),
        ], fx: fx)
        #expect(groups.count == 1)
        let g = groups[0]
        #expect(g.brand?.key == "netflix")
        #expect(g.count == 2)
        // son ödeme = en yeni tarih
        #expect(g.latestAmount == 199.99)
        #expect(g.lastDate == "2026-07-05")
        #expect(g.totalTry == 349.98)
    }
    @Test func separatesBrandsSortedByMonthlyEstimate() {
        let groups = Subscriptions.groupSubscriptions([
            sub(["id": "1", "description": "Spotify", "amount": 59.99]),
            sub(["id": "2", "description": "Netflix", "amount": 199.99]),
        ], fx: fx)
        #expect(groups.count == 2)
        #expect(groups[0].brand?.key == "netflix") // yüksek aylık tahmin önce
        #expect(groups[1].brand?.key == "spotify")
    }
    @Test func foreignCurrencyMonthlyEstimateInTry() {
        let g = Subscriptions.groupSubscriptions([
            sub(["description": "OpenAI ChatGPT", "currency": "USD", "amount": 20]),
        ], fx: fx)[0]
        #expect(g.brand?.key == "openai")
        #expect(g.monthlyEstimateTry == 690) // 20 USD × 34.5
    }
}

@Suite("abonelik — findSubscriptionGroup")
struct FindSubscriptionGroupTests {
    let data = [
        sub(["id": "1", "description": "Netflix", "amount": 199.99, "date": "2026-07-05"]),
        sub(["id": "2", "description": "Netflix", "amount": 149.99, "date": "2026-06-05"]),
        sub(["id": "3", "description": "Spotify", "amount": 59.99, "date": "2026-07-10"]),
    ]

    @Test func returnsGroupForKnownKey() throws {
        let g = try #require(Subscriptions.findSubscriptionGroup(data, key: "brand:netflix", fx: fx))
        #expect(g.brand?.key == "netflix")
        #expect(g.count == 2)
        #expect(g.txs.map(\.id) == ["1", "2"]) // en yeni önce
    }
    @Test func nullForUnknownKey() {
        #expect(Subscriptions.findSubscriptionGroup(data, key: "brand:disneyplus", fx: fx) == nil)
        #expect(Subscriptions.findSubscriptionGroup([], key: "brand:netflix", fx: fx) == nil)
    }
}

@Suite("abonelik — summarize")
struct SummarizeTests {
    let data = [
        sub(["id": "1", "description": "Netflix", "amount": 199.99, "date": "2026-07-05"]),
        sub(["id": "2", "description": "Spotify", "amount": 59.99, "date": "2026-07-10"]),
        sub(["id": "3", "description": "Netflix", "amount": 149.99, "date": "2026-06-05"]), // önceki ay
        sub(["id": "4", "description": "Migros", "amount": 500, "date": "2026-07-08", "tags": tags()]), // abonelik değil
    ]

    @Test func monthTotalCountsOnlyCurrentMonthCharges() {
        let s = Subscriptions.summarize(data, monthStr: "2026-07", fx: fx)
        #expect(s.monthTotalTry == 259.98) // 199.99 + 59.99; Haziran ve Migros hariç
    }
    @Test func serviceCountIsDistinctServices() {
        #expect(Subscriptions.summarize(data, monthStr: "2026-07", fx: fx).serviceCount == 2)
    }
    @Test func monthlyEstimateSumsLatestCharges() {
        let s = Subscriptions.summarize(data, monthStr: "2026-07", fx: fx)
        #expect(s.monthlyEstimateTry == 259.98) // Netflix son 199.99 + Spotify 59.99
    }
    @Test func emptyLedgerZeros() {
        let s = Subscriptions.summarize([], monthStr: "2026-07", fx: fx)
        #expect(s.groups.isEmpty)
        #expect(s.serviceCount == 0)
        #expect(s.monthTotalTry == 0)
        #expect(s.monthlyEstimateTry == 0)
    }
}

@Suite("abonelik — subscriptionMonthlyHistory")
struct SubscriptionHistoryTests {
    let data = [
        sub(["id": "1", "description": "Netflix", "amount": 199.99, "date": "2026-07-05"]),
        sub(["id": "2", "description": "Spotify", "amount": 59.99, "date": "2026-07-10"]),
        sub(["id": "3", "description": "Netflix", "amount": 149.99, "date": "2026-05-05"]),
        sub(["id": "4", "description": "OpenAI", "amount": 20, "currency": "USD", "date": "2026-05-20"]),
        sub(["id": "5", "description": "Migros", "amount": 500, "date": "2026-07-08", "tags": tags()]), // abonelik değil
        sub(["id": "6", "description": "Netflix", "amount": 199.99, "date": "2026-08-05"]), // endMonth sonrası
        sub(["id": "7", "description": "Netflix", "amount": 99, "date": "2025-12-05"]),    // kısa pencere öncesi
    ]

    @Test func zeroFillsFixedWindowOldestFirst() {
        let h = Subscriptions.subscriptionMonthlyHistory(data, months: 3, endMonth: "2026-07", fx: fx)
        #expect(h.map(\.month) == ["2026-05", "2026-06", "2026-07"])
        #expect(h[1] == SubscriptionMonth(month: "2026-06", totalTry: 0, count: 0, services: []))
    }
    @Test func sumsMonthInTryAndSortsServicesBySpend() {
        let h = Subscriptions.subscriptionMonthlyHistory(data, months: 3, endMonth: "2026-07", fx: fx)
        let may = h[0], jul = h[2]
        #expect(may.totalTry == 839.99) // 149.99 + 20 USD × 34.5
        #expect(may.count == 2)
        #expect(may.services.map(\.key) == ["brand:openai", "brand:netflix"])
        #expect(jul.totalTry == 259.98) // Migros hariç
        #expect(jul.services.map(\.name) == ["Netflix", "Spotify"])
    }
    @Test func currentMonthMatchesSummarize() {
        let h = Subscriptions.subscriptionMonthlyHistory(data, months: 12, endMonth: "2026-07", fx: fx)
        #expect(h.last?.totalTry == Subscriptions.summarize(data, monthStr: "2026-07", fx: fx).monthTotalTry)
    }
    @Test func serviceKeysLinkToGroups() {
        let keys = Set(Subscriptions.groupSubscriptions(data, fx: fx).map(\.key))
        for m in Subscriptions.subscriptionMonthlyHistory(data, months: .all, endMonth: "2026-07", fx: fx) {
            for s in m.services { #expect(keys.contains(s.key)) }
        }
    }
    @Test func crossesYearBoundary() {
        let h = Subscriptions.subscriptionMonthlyHistory(data, months: 3, endMonth: "2026-01", fx: fx)
        #expect(h.map(\.month) == ["2025-11", "2025-12", "2026-01"])
        #expect(h[1].totalTry == 99)
    }
    @Test func allStartsAtEarliestAndExcludesLater() {
        let h = Subscriptions.subscriptionMonthlyHistory(data, months: .all, endMonth: "2026-07", fx: fx)
        #expect(h.first?.month == "2025-12")
        #expect(h.last?.month == "2026-07")
        #expect(h.count == 8)
        #expect(!h.contains { $0.month == "2026-08" })
    }
    @Test func bucketsLegacyIsoDatetimesByMonth() {
        let h = Subscriptions.subscriptionMonthlyHistory(
            [sub(["date": "2026-07-31T23:30:00.000Z", "amount": 50])],
            months: 1, endMonth: "2026-07", fx: fx)
        #expect(h[0].totalTry == 50)
    }
    @Test func allWithNoChargesIsEmpty() {
        #expect(Subscriptions.subscriptionMonthlyHistory([], months: .all, endMonth: "2026-07", fx: fx).isEmpty)
    }
}

@Suite("abonelik — zam (priceChange)")
struct PriceChangeTests {
    @Test func riseCountsDropAndSubOnePercentDoNot() throws {
        let g = Subscriptions.groupSubscriptions([
            sub(["id": "1", "amount": 199.99, "date": "2026-07-05"]),
            sub(["id": "2", "amount": 229.99, "date": "2026-08-05"]),
        ], fx: fx)[0]
        let pc = try #require(g.priceChange)
        #expect(pc.from == 199.99)
        #expect(pc.to == 229.99)
        #expect(pc.date == "2026-08-05")
        #expect(abs(pc.pct - 15) < 0.5) // toBeCloseTo(15, 0)

        #expect(Subscriptions.groupSubscriptions([
            sub(["id": "1", "amount": 229.99, "date": "2026-07-05"]),
            sub(["id": "2", "amount": 199.99, "date": "2026-08-05"]),
        ], fx: fx)[0].priceChange == nil)
        #expect(Subscriptions.groupSubscriptions([
            sub(["id": "1", "amount": 100, "date": "2026-07-05"]),
            sub(["id": "2", "amount": 100.5, "date": "2026-08-05"]),
        ], fx: fx)[0].priceChange == nil)
    }
    @Test func singleChargeOrDifferentCurrencyNoComparison() {
        #expect(Subscriptions.groupSubscriptions([sub()], fx: fx)[0].priceChange == nil)
        #expect(Subscriptions.groupSubscriptions([
            sub(["id": "1", "amount": 10, "currency": "USD", "date": "2026-07-05"]),
            sub(["id": "2", "amount": 400, "date": "2026-08-05"]),
        ], fx: fx)[0].priceChange == nil)
    }
}

/* ── Web testinde olmayan, koddan türetilmiş ek kontroller ── */

@Suite("abonelik — normalize / kayıt")
struct SubscriptionsNormalizeTests {
    @Test func normalizeMatchesWeb() {
        #expect(Subscriptions.normalize("ABONELİK") == "abonelik")
        #expect(Subscriptions.normalize("  Netflıx   Türkiye\t\n") == "netflix turkiye")
        #expect(Subscriptions.normalize("Şğüöç") == "sguoc")
        #expect(Subscriptions.normalize("   ") == "")
    }
    @Test func registryOrderAndLogos() {
        #expect(Subscriptions.brands.count == 39)
        #expect(Subscriptions.brands.first?.key == "netflix")
        #expect(Subscriptions.brands.last?.key == "fizy")
        #expect(Subscriptions.brands.filter(\.hasLogo).count == 29)
        #expect(Set(Subscriptions.brands.map(\.key)).count == Subscriptions.brands.count)
    }
    @Test func groupKeysAndNames() {
        let groups = Subscriptions.groupSubscriptions([
            sub(["id": "1", "description": "  Bakkal  Ahmet ", "amount": 10]),
            sub(["id": "2", "description": "bakkal ahmet", "amount": 10, "createdAt": "2026-07-05T01:00:00Z"]),
            sub(["id": "3", "description": "   ", "amount": 5]),
            sub(["id": "4", "description": "Kasa", "notes": "HBO Max aylık", "amount": 1]),
        ], fx: fx)
        #expect(groups.map(\.key) == ["desc:bakkal ahmet", "desc:diger", "brand:max"])
        #expect(groups[0].txs.map(\.id) == ["2", "1"])   // aynı tarih → createdAt yeni önce
        #expect(groups[0].name == "bakkal ahmet")
        #expect(groups[1].name == "Abonelik")
        #expect(groups[2].name == "Max")
    }
    @Test func shiftMonth() {
        #expect(Subscriptions.shiftMonth("2026-01", -1) == "2025-12")
        #expect(Subscriptions.shiftMonth("2026-12", 1) == "2027-01")
        #expect(Subscriptions.shiftMonth("2026-07", -11) == "2025-08")
    }
}

@Suite("abonelik etiketi (form)")
struct SubscriptionTagDraftTests {
    let account = Account(raw: ["id": "a", "name": "Kart", "type": "credit_card", "currency": "TRY"])

    @Test func yeniGiderEtiketlenir() {
        var d = TransactionDraft()
        d.amountText = "229,99"; d.accountId = "a"; d.isSubscription = true
        let t = d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30")
        #expect(t.tags == ["abonelik"])
        d.type = .income
        #expect(d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30").tags == [])
    }

    @Test func duzenlemedeDigerEtiketlerKorunur() {
        let t = tx(["tags": .array(["iş", "ABONELİK"]), "accountId": "a", "amount": 10])
        var d = TransactionDraft(editing: t)
        #expect(d.isSubscription)
        d.isSubscription = false
        #expect(d.applying(to: t, account: account, fx: fx).raw["tags"] == .array(["iş"]))
        let plain = tx(["tags": .array(["iş", "iş"]), "accountId": "a", "amount": 10])
        var d2 = TransactionDraft(editing: plain)
        d2.isSubscription = true
        #expect(d2.applying(to: plain, account: account, fx: fx).raw["tags"] == .array(["iş", "abonelik"]))
        // Değişmediyse etikete dokunulmaz
        #expect(TransactionDraft(editing: plain).applying(to: plain, account: account, fx: fx).raw["tags"] == .array(["iş", "iş"]))
    }

    @Test func serbestEtiketlerTemizlenipYazilir() {
        var d = TransactionDraft()
        d.amountText = "50"; d.accountId = "a"; d.isSubscription = true
        d.tags = [" Tatil ", "tatil", "", "İş"]
        let t = d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30")
        #expect(t.tags == ["Tatil", "İş", "abonelik"])
        // Gelir: abonelik düşer, diğer etiketler kalır
        d.type = .income
        #expect(d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30").tags == ["Tatil", "İş"])
    }

    /// Web gelir/transfer satırına abonelik koyduysa iOS düzenlemesi silmez
    @Test func gelirdekiAbonelikEtiketiKorunur() {
        let t = tx(["type": "income", "tags": .array(["Abonelik", "iş"]), "accountId": "a", "amount": 10])
        var d = TransactionDraft(editing: t)
        d.amountText = "20"
        #expect(d.applying(to: t, account: account, fx: fx).raw["tags"] == .array(["Abonelik", "iş"]))
        d.tags.append("ek")
        #expect(d.applying(to: t, account: account, fx: fx).raw["tags"] == .array(["iş", "ek", "abonelik"]))
        // Giderden gelire çevrilen satır da etiketi korur
        let e = tx(["type": "expense", "tags": .array(["abonelik"]), "accountId": "a", "amount": 10])
        var d2 = TransactionDraft(editing: e)
        d2.type = .income
        #expect(d2.applying(to: e, account: account, fx: fx).raw["tags"] == .array(["abonelik"]))
    }

    @Test func duzenlemedeEtiketEklenirCikarilir() {
        let t = tx(["tags": .array(["iş", "abonelik"]), "accountId": "a", "amount": 10])
        var d = TransactionDraft(editing: t)
        #expect(d.tags == ["iş"])
        d.tags.append("Tatil")
        #expect(d.applying(to: t, account: account, fx: fx).raw["tags"] == .array(["iş", "Tatil", "abonelik"]))
        d.tags = []
        #expect(d.applying(to: t, account: account, fx: fx).raw["tags"] == .array(["abonelik"]))
    }

    /// Kişiler (web people): değişmediyse ham satıra dokunulmaz; transferde boşalır
    @Test func kisilerYazilir() {
        var d = TransactionDraft()
        d.amountText = "50"; d.accountId = "a"; d.recipientId = "p1"; d.familyMemberId = "f1"
        let t = d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30")
        #expect(t.recipientId == "p1" && t.familyMemberId == "f1")
        d.type = .transfer; d.toAccountId = "b"
        let tr = d.makeNew(account: account, workspaceId: nil, fx: fx, now: "n", today: "2026-09-30")
        #expect(tr.recipientId == nil && tr.familyMemberId == nil)

        let old = tx(["recipientId": "p1", "accountId": "a", "amount": 10])
        var e = TransactionDraft(editing: old)
        #expect(e.applying(to: old, account: account, fx: fx).raw["familyMemberId"] == nil)   // dokunulmadı
        e.recipientId = nil
        #expect(e.applying(to: old, account: account, fx: fx).raw["recipientId"] == .null)
        e.familyMemberId = "f2"
        #expect(e.applying(to: old, account: account, fx: fx).raw["familyMemberId"] == "f2")
    }
}
