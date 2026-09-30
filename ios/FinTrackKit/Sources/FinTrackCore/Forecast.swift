import Foundation

/* ── Bakiye tahmini — web src/lib/utils/forecast.ts (buildForecast,
   futureDebtPayments, makeEventDelta, addMonthsIso) birebir karşılığı. ─────
   SAF bir ileri projeksiyon: başlangıç = arşivlenmemiş hesapların net değeri
   (Calc.netWorth) + portföy değeri (investmentsTry — fiyatlar düz tutulur,
   varlık fiyatı tahmin edilmez). Oradan aktif tekrarlayan şablonların her
   gelecek dönemi, gelecek tarihli tek seferlik işlemler ve takip edilen
   borçların ödenmemiş taksitleri tarihinde işaretli TRY farkı olarak uygulanır.
   Kendi hesaplar arası transfer toplamda sıfırlanır → olay değildir.

   Modlar:
   .total — TÜM hesaplar (kart borcu dahil) + portföy. Transferler görünmez.
   .cash  — likit hesaplar (nakit/vadesiz/birikim) + TEFAS fonları (fundsTry,
            T+1/T+2 bozdurulabilir → harcanabilir sayılır). Kart borcu, kredi,
            yatırım hesabı ve portföyün geri kalanı başlangıçta yok. Likit
            sınırını AŞAN transfer gerçek nakit olayıdır: kart ödemesi ödeme
            günü nakitten düşer (gider gibi), vadesiz hesaba kredi girişi nakit
            ekler (gelir gibi). Karta yazılan gider o gün nakde dokunmaz — nakit
            ödeme günü çıkar (çift sayım olmaz).

   Tüm para hesabı Money (tam sayı kuruş, S8) ile; döviz tutarları canlı kurla
   FX.toBaseTry / FX.baseAmount üzerinden TRY'ye çevrilir. Web'deki hesap
   `balance` alanı çalışma anı değeridir: burada `balances` (hesap id → kendi
   para biriminde bakiye) olarak verilir; web `prices` yerine FX kullanılır.
─────────────────────────────────────────────────────────────────────────── */

public enum ForecastMode: String, Sendable, CaseIterable {
    case total, cash
}

/// Tahmin olayının yönü (web 'income' | 'expense').
public enum ForecastFlow: String, Sendable {
    case income, expense
}

public struct ForecastPoint: Hashable, Sendable {
    public var date: String      // yyyy-MM-dd
    public var balance: Double   // bu günün sonunda öngörülen bakiye (TRY)

    public init(date: String, balance: Double) {
        self.date = date
        self.balance = balance
    }
}

public struct ForecastEvent: Hashable, Sendable {
    /// Olayın kaynağı (web'de yok; iOS ekranı kaynağa gitmek için kullanır).
    public enum Source: String, Sendable { case recurring, transaction, debt }

    public var date: String          // yyyy-MM-dd
    public var name: String          // şablon adı ya da tek seferlik işlemin açıklaması
    public var type: ForecastFlow
    public var amountTry: Double     // TRY büyüklük (daima pozitif — web ile aynı)
    public var balanceAfter: Double  // bu olaydan hemen sonraki bakiye (TRY)
    public var source: Source
    public var sourceId: String      // şablon / işlem / borç kimliği

    /// İşaretli fark: gelir +, gider −.
    public var delta: Double { type == .income ? amountTry : -amountTry }

    public init(date: String, name: String, type: ForecastFlow, amountTry: Double, balanceAfter: Double,
                source: Source, sourceId: String) {
        self.date = date
        self.name = name
        self.type = type
        self.amountTry = amountTry
        self.balanceAfter = balanceAfter
        self.source = source
        self.sourceId = sourceId
    }
}

public struct ForecastDriver: Hashable, Sendable {
    public var id: String            // şablon id'si; borçta "debt-<id>"
    public var name: String
    public var type: ForecastFlow
    public var monthlyTry: Double    // aylık eşdeğer etki büyüklüğü (TRY) — web monthlyEquivTry

    public init(id: String, name: String, type: ForecastFlow, monthlyTry: Double) {
        self.id = id
        self.name = name
        self.type = type
        self.monthlyTry = monthlyTry
    }
}

public struct ForecastResult: Hashable, Sendable {
    public var start: Double             // başlangıç bakiyesi (bugün, TRY) — points[0].balance
    public var points: [ForecastPoint]
    public var horizonEnd: String        // projeksiyonun kapsadığı son gün
    public var shortfallDate: String?    // bakiyenin ilk kez < 0 olduğu gün
    public var totalIncome: Double       // ufuktaki pozitif farkların toplamı
    public var totalExpense: Double      // ufuktaki negatif farkların mutlak toplamı
    public var net: Double               // totalIncome − totalExpense
    public var events: [ForecastEvent]   // her olay, tarih artan (gün içi ekleme sırası)
    public var drivers: [ForecastDriver] // aylık eşdeğere göre azalan
}

public enum Forecast {
    /// Likit hesap türleri (web LIQUID_TYPES).
    public static let liquidTypes: Set<AccountType> = [.cash, .checking, .savings]

    /// Frekans başına ortalama dönem/ay — "sürücüler" için aylık eşdeğer
    /// (Gregoryen ortalama ay = 30.4375 gün).
    public static func monthlyFactor(_ f: RecurringFrequency) -> Double {
        switch f {
        case .daily: 30.4375
        case .weekly: 4.34524
        case .monthly: 1
        case .yearly: 1.0 / 12
        }
    }

    /// ISO tarihe `months` takvim ayı ekler; gün hedef ayın uzunluğuna kırpılır
    /// (31 Ocak + 1 ay → 28/29 Şubat). Borçlar sayfasındaki planla aynı.
    /// Ayrıştırılamayan girdi olduğu gibi döner (web "NaN-…" üretirdi).
    public static func addMonthsIso(_ iso: String, _ months: Int) -> String {
        let p = iso.prefix(10).split(separator: "-", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard p.count == 3 else { return iso }
        let (y, m, d) = (p[0], p[1], p[2])
        let total = m - 1 + months
        let ny = y + Int((Double(total) / 12).rounded(.down))
        let nm = ((total % 12) + 12) % 12
        let last = daysInMonth(ny, nm + 1)
        return String(format: "%d-%02d-%02d", ny, nm + 1, min(d, last))
    }

    private static func daysInMonth(_ y: Int, _ m: Int) -> Int {
        switch m {
        case 2: (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: 30
        default: 31
        }
    }

    public struct DebtPayment: Hashable, Sendable {
        public var date: String    // yyyy-MM-dd
        public var amount: Double  // TRY, ödenmemiş kısmın büyüklüğü

        public init(date: String, amount: Double) {
            self.date = date
            self.amount = amount
        }
    }

    /// Takip edilen borcun gelecekteki, henüz ödenmemiş taksitleri (monthlyPayment
    /// planından). Yalnız (after, until] aralığındakiler; paidAmount'un karşıladığı
    /// kısım düşülür (kısmi ödenmiş taksit yalnız kalanıyla, tam ödenmiş hiç
    /// girmez). Borç tutarları TRY (Debt'te para birimi yok) → kur çevrimi yok.
    public static func futureDebtPayments(_ debt: Debt, after: String, until horizonEnd: String) -> [DebtPayment] {
        guard !debt.isSettled, let monthly = debt.monthlyPayment, monthly > 0 else { return [] }
        let count: Int
        if let n = debt.totalInstallments, n > 0 {
            count = n
        } else {
            // Oran Double'da sınanır: aşırı değerde Int dönüşümü çökmesin (web: > 600 → boş)
            let ratio = (debt.totalAmount / monthly).rounded(.up)
            guard ratio.isFinite, ratio > 0, ratio <= 600 else { return [] }
            count = Int(ratio)
        }
        guard count > 0, count <= 600 else { return [] }

        // Son taksit yuvarlama kalanını taşır → plan toplamı borca eşit.
        let remainder = Money.round(Money.sub(debt.totalAmount, Money.mul(monthly, Double(count - 1))))
        var out: [DebtPayment] = []
        var cumulative = 0.0
        for i in 0..<count {
            let amount = i == count - 1 && remainder > 0 ? remainder : monthly
            let prevCumulative = cumulative
            cumulative = Money.add(cumulative, amount)
            // Takvim daima başlangıçtan (= ilk taksit) ileri doğru kurulur; vade planı
            // kaydırmaz (debts sayfasındaki takvimle birebir).
            let date = addMonthsIso(debt.startDate, i)
            if date <= after || date > horizonEnd { continue }
            // Bu taksitin ödenmemiş kısmı (kısmi ödemeyi de ele alır).
            let covered = max(prevCumulative, debt.paidAmount)
            let unpaid = min(amount, max(0, Money.sub(cumulative, covered)))
            if unpaid > 0.005 { out.append(DebtPayment(date: date, amount: unpaid)) }
        }
        return out
    }

    /// Bir hareketin bu modun bakiyesine işaretli TRY etkisi; bakiyeyi hiç
    /// oynatmıyorsa nil (web makeEventDelta). Bilinmeyen hesap (ör. arşivlenmiş,
    /// listede yok) likit sayılır: nakit modu sessizce olayı düşürmek yerine
    /// toplam mod davranışına geriler.
    public static func eventDelta(accounts: [Account], mode: ForecastMode)
        -> (_ type: TransactionType, _ amountTry: Double, _ accountId: String, _ toAccountId: String?) -> Double? {
        let cash = mode == .cash
        var liquidById: [String: Bool] = [:]
        for a in accounts { liquidById[a.id] = liquidTypes.contains(a.type) }   // web Map: son yazan kazanır
        let isLiquid = { (id: String) in liquidById[id] ?? true }

        return { type, amountTry, accountId, toAccountId in
            if !cash {
                switch type {
                case .income: return amountTry
                case .expense: return -amountTry
                case .transfer: return nil   // toplamda transferler sıfırlanır
                }
            }
            let fromLiquid = isLiquid(accountId)
            if type == .income { return fromLiquid ? amountTry : nil }
            if type == .expense { return fromLiquid ? -amountTry : nil }
            guard let to = toAccountId else { return nil }
            let toLiquid = isLiquid(to)
            if fromLiquid && !toLiquid { return -amountTry }   // ör. kredi kartı ödemesi
            if !fromLiquid && toLiquid { return amountTry }
            return nil   // likit havuz içinde (ya da tamamen dışında)
        }
    }

    private struct RawEvent {
        var date: String
        var delta: Double
        var name: String
        var type: ForecastFlow
        var source: ForecastEvent.Source
        var sourceId: String
    }

    private static func flow(_ delta: Double) -> ForecastFlow { delta >= 0 ? .income : .expense }

    /// JS `Array.prototype.sort` gibi KARARLI sıralama (eşitlerde giriş sırası korunur).
    private static func stableSorted<T>(_ items: [T], by less: (T, T) -> Bool) -> [T] {
        items.enumerated()
            .sorted { less($0.element, $1.element) || (!less($1.element, $0.element) && $0.offset < $1.offset) }
            .map(\.element)
    }

    public static func build(accounts: [Account], balances: [String: Double],
                             recurring: [RecurringTransaction], transactions: [Transaction] = [],
                             debts: [Debt] = [], fx: FX, investmentsTry: Double = 0, fundsTry: Double = 0,
                             horizonMonths: Int, today: String, mode: ForecastMode = .total) -> ForecastResult {
        let cash = mode == .cash
        let delta = eventDelta(accounts: accounts, mode: mode)

        // .total tüm portföyü taşır; .cash yalnız TEFAS dilimini.
        let startAccounts = cash ? accounts.filter { liquidTypes.contains($0.type) } : accounts
        let start = Money.add(Calc.netWorth(startAccounts, balances: balances, fx: fx), cash ? fundsTry : investmentsTry)
        let horizonEnd = addMonthsIso(today, horizonMonths)

        // 1. Bu modun bakiyesini oynatan aktif şablonların her gelecek dönemi,
        //    tarihinde işaretli TRY farkı olarak.
        var events: [RawEvent] = []
        for r in recurring where r.isActive {
            guard let d = delta(r.type, fx.toBaseTry(r.amount, r.currency), r.accountId, r.toAccountId) else { continue }
            for occ in Recurrence.occurrences(r, asOf: horizonEnd) where occ > today {
                events.append(RawEvent(date: occ, delta: d, name: r.name, type: flow(d), source: .recurring, sourceId: r.id))
            }
        }

        // 1b. Gelecek tarihli tek seferlik işlemler: bugünkü bakiyede yoklar
        //     (bekliyorlar), kendi tarihlerinde projeksiyona girerler. Bakiye
        //     eşitleme hayaletleri ileri taşınmaz.
        for t in transactions {
            if Calc.isReconciliation(t) { continue }
            let day = String(t.date.prefix(10))
            if day <= today || day > horizonEnd { continue }
            guard let d = delta(t.type, fx.baseAmount(t), t.accountId, t.toAccountId) else { continue }
            // web: description || merchant || 'İşlem' (boş metin de atlanır)
            let name = !t.description.isEmpty ? t.description : (t.merchant.flatMap { $0.isEmpty ? nil : $0 } ?? "İşlem")
            events.append(RawEvent(date: day, delta: d, name: name, type: flow(d), source: .transaction, sourceId: t.id))
        }

        // 1c. Takip edilen borçlar: monthlyPayment'tan türeyen gelecek taksitler.
        //     Geçmiş ödemeler zaten gerçek işlem (başlangıçta sayılı) → yalnız
        //     ileri tarihli, ödenmemiş dilimler. 'owe' bakiyeyi eritir (gider),
        //     'owed' bize geri dönen para (gelir). accountId nakit modunda
        //     likiditeyi belirler; bilinmeyen/boş likit sayılır.
        var debtPaid = Set<String>()   // en az bir gelecek olay üreten borçlar (sürücüler için)
        for debt in debts {
            let type: TransactionType = debt.direction == "owed" ? .income : .expense
            for p in futureDebtPayments(debt, after: today, until: horizonEnd) {
                guard let d = delta(type, p.amount, debt.accountId ?? "", nil) else { continue }
                debtPaid.insert(debt.id)
                events.append(RawEvent(date: p.date, delta: d, name: debt.name, type: flow(d), source: .debt, sourceId: debt.id))
            }
        }

        // 2. Ufuk toplamları (kuruş kesin).
        let totalIncome = Money.sum(events.filter { $0.delta > 0 }) { $0.delta }
        let totalExpense = Money.sum(events.filter { $0.delta < 0 }) { -$0.delta }
        let net = Money.sub(totalIncome, totalExpense)

        // 3. Aynı güne düşen olaylar tek gün farkına katlanır; bakiye bugünden
        //    kümülatif yürür.
        var dayDelta: [String: Double] = [:]
        for e in events { dayDelta[e.date] = Money.add(dayDelta[e.date] ?? 0, e.delta) }
        var points = [ForecastPoint(date: today, balance: start)]
        var running = start
        var shortfallDate: String?
        for d in dayDelta.keys.sorted() {
            running = Money.add(running, dayDelta[d]!)
            points.append(ForecastPoint(date: d, balance: running))
            if shortfallDate == nil && running < 0 { shortfallDate = d }
        }

        // 3b. Olay bazlı zaman çizelgesi: aynı yürüyüş, her dönem bir satır (UI
        //     bakiyeyi HANGİ işlemin oynattığını gösterir). Kararlı sıralama gün
        //     içi ekleme sırasını korur; günün son olayı o günün noktasına eşittir.
        var eventRunning = start
        let eventRows: [ForecastEvent] = stableSorted(events) { $0.date < $1.date }.map { e in
            eventRunning = Money.add(eventRunning, e.delta)
            return ForecastEvent(date: e.date, name: e.name, type: e.type, amountTry: abs(e.delta),
                                 balanceAfter: eventRunning, source: e.source, sourceId: e.sourceId)
        }

        // 4. Sürücüler: bu modun bakiyesini oynatan her aktif şablonun aylık
        //    eşdeğeri (nakit modunda sınırı aşan transferler de — ör. kart ödemesi —
        //    farkın işaretine göre sınıflanır).
        var drivers: [ForecastDriver] = recurring.filter(\.isActive).compactMap { r in
            guard let d = delta(r.type, fx.toBaseTry(r.amount, r.currency), r.accountId, r.toAccountId) else { return nil }
            return ForecastDriver(id: r.id, name: r.name, type: flow(d),
                                  monthlyTry: Money.mul(abs(d), monthlyFactor(r.frequency)))
        }

        // Borç sürücüleri: yalnız bu mod/ufukta gerçekten gelecek ödeme üreten
        // borçlar, monthlyPayment tutarıyla (zaten aylık).
        for debt in debts where debtPaid.contains(debt.id) {
            guard let monthly = debt.monthlyPayment, monthly > 0 else { continue }
            let type: TransactionType = debt.direction == "owed" ? .income : .expense
            guard let d = delta(type, monthly, debt.accountId ?? "", nil) else { continue }
            drivers.append(ForecastDriver(id: "debt-\(debt.id)", name: debt.name, type: flow(d), monthlyTry: abs(d)))
        }
        drivers = stableSorted(drivers) { $0.monthlyTry > $1.monthlyTry }

        return ForecastResult(start: start, points: points, horizonEnd: horizonEnd, shortfallDate: shortfallDate,
                              totalIncome: totalIncome, totalExpense: totalExpense, net: net,
                              events: eventRows, drivers: drivers)
    }
}
