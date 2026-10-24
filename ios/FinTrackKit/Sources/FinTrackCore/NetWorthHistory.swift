import Foundation

/* ── Net varlık trendi — web reports "Net Varlık Trendi" + calculations.ts
   buildDebtBurdenSeries ──────────────────────────────────────────────────
   Çıpa BUGÜNKÜ net değer (hesaplar + yatırım piyasa değeri − kalan borç);
   geriye doğru: o tarihten sonraki nakit ve yatırım hareketleri düşülür,
   o tarihteki borç yükü (sonraki ödemeler geri eklenerek) çıkarılır.
   Yatırım hareketleri GÜNCEL fiyatla (web ile aynı — geçmiş fiyat yok).
─────────────────────────────────────────────────────────────────────────── */

public enum NetWorthHistory {
    /// Verilen tarihlerdeki borç yükü (TRY): kapanmamış 'owe' borçların o günkü kalanı.
    public static func debtBurdenSeries(_ debts: [Debt], _ txs: [Transaction], dates: [String], fx: FX) -> [Double] {
        var out = [Int](repeating: 0, count: dates.count)
        let owe = debts.filter { $0.owe && $0.isLive }
        guard !owe.isEmpty, !dates.isEmpty else { return out.map(Money.toMajor) }
        let ids = Set(owe.map(\.id))
        var pays: [String: [(date: String, amount: Double)]] = [:]
        for t in txs where t.isLive {
            guard let id = t.debtId, ids.contains(id) else { continue }
            pays[id, default: []].append((String(t.date.prefix(10)), fx.baseAmount(t)))
        }
        for k in pays.keys { pays[k]!.sort { $0.date > $1.date } }
        for d in owe {
            let list = pays[d.id] ?? []
            let total = Money.toMinor(d.totalAmount)
            let start = String(d.startDate.prefix(10))
            var rem = Money.toMinor(d.isSettled ? 0 : max(0, Money.sub(d.totalAmount, d.paidAmount)))
            var p = 0
            for i in stride(from: dates.count - 1, through: 0, by: -1) {
                let day = dates[i]
                while p < list.count && list[p].date > day { rem += Money.toMinor(list[p].amount); p += 1 }
                if start <= day { out[i] += min(total, max(0, rem)) }
            }
        }
        return out.map(Money.toMajor)
    }

    /// Ay sonu noktaları (son `months` ay) + bugün; eskiden yeniye.
    public static func monthly(accounts: [Account], balances: [String: Double], transactions: [Transaction],
                               investments: [InvestmentTransaction], prices: PriceBook, debts: [Debt], fx: FX,
                               months: Int = 12, today: String = DateUtil.today()) -> [(date: String, value: Double)] {
        guard let t = DateUtil.parseDay(today) else { return [] }
        var dates: [String] = []
        var my = MonthYear.current(t)
        for _ in 0..<months {
            my = my.previous
            dates.insert(DateUtil.monthRange(my).to, at: 0)
        }
        dates.append(today)

        let live = accounts.filter { !$0.isArchived && $0.isLive }
        let ids = Set(live.map(\.id))
        let investNow = Money.sum(Portfolio.holdings(investments.filter(\.isLive), prices: prices)) { $0.currentValue }
        let assetsNow = Money.add(Calc.netWorth(live, balances: balances, fx: fx), investNow)

        // Tarih → net varlık değişimi (minor, TRY)
        var delta: [String: Int] = [:]
        for tx in Calc.excludeFuture(transactions, asOf: today) where tx.isLive {
            let amt = Money.toMinor(fx.baseAmount(tx))
            var d = 0
            if tx.type == .transfer {
                if ids.contains(tx.accountId) { d -= amt }
                if let to = tx.toAccountId, ids.contains(to) { d += amt }
            } else if ids.contains(tx.accountId) {
                d = tx.type == .income ? amt : -amt
            }
            if d != 0 { delta[String(tx.date.prefix(10)), default: 0] += d }
        }
        for inv in investments where inv.isLive {
            let v = (inv.type == "buy" ? 1.0 : -1.0) * inv.quantity * prices.price(inv.asset)
            delta[String(inv.date.prefix(10)), default: 0] += Money.toMinor(v)
        }
        let burdens = debtBurdenSeries(debts, transactions, dates: dates, fx: fx)
        let sortedDeltas = delta.sorted { $0.key < $1.key }
        return dates.enumerated().map { i, day in
            var after = 0
            for (d, m) in sortedDeltas where d > day && d <= today { after += m }
            let assets = Money.toMinor(assetsNow) - after
            return (day, Money.toMajor(assets - Money.toMinor(burdens[i])))
        }
    }
}
