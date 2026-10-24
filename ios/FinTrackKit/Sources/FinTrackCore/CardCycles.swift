import Foundation

/* ── Kredi kartı döngüleri: tatiller, banka kuralları, ay ay kesim / son ödeme ──
   Kaynak (birebir): web src/lib/payments/tr-holidays.ts, bank-rules.ts,
   card-cycles.ts. Testler bank-rules.test.ts ve card-cycles.test.ts ile aynı
   girdiler (CardCyclesTests.swift). Biri değişirse diğeri de değişmeli.

   Tarihler "yyyy-MM-dd" metinleridir, metin sırasıyla kıyaslanır. Gün
   aritmetiği Gregoryen takvimde yapılır; web UTC tarihle çalışır (Date.UTC),
   burada aynı sonucu vermesi için gün öğlen 12:00'ye kurulur — yaz saati
   geçişi günü kaydırmaz. Web'in "hafta sonu mu?" sorusu tarih-yalnız metnin UTC
   haftanın günüdür; bu, o takvim gününün haftanın günüyle aynıdır.
─────────────────────────────────────────────────────────────────────────── */

// MARK: - Gün aritmetiği (yyyy-MM-dd)

enum ISODay {
    static func parts(_ iso: String) -> (y: Int, m: Int, d: Int)? {
        let p = iso.prefix(10).split(separator: "-")
        guard p.count == 3, let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
        return (y, m, d)
    }

    static func date(_ y: Int, _ m: Int, _ d: Int) -> Date? {
        DateUtil.calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12))
    }

    static func format(_ date: Date) -> String {
        let c = DateUtil.calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Web `addDays` / `addDaysIso`: Date.UTC(y, m-1, d+n). Geçersiz metin → aynen.
    static func add(_ iso: String, _ n: Int) -> String {
        guard let (y, m, d) = parts(iso), let base = date(y, m, d),
              let t = DateUtil.calendar.date(byAdding: .day, value: n, to: base) else { return iso }
        return format(t)
    }

    /// Haftanın günü, JS getUTCDay biçiminde: 0 = Pazar … 6 = Cumartesi.
    static func weekday(_ iso: String) -> Int? {
        guard let (y, m, d) = parts(iso), let t = date(y, m, d) else { return nil }
        return DateUtil.calendar.component(.weekday, from: t) - 1   // Calendar: 1 = Pazar
    }

    /// Ayın gün sayısı ("YYYY-MM").
    static func daysIn(_ month: String) -> Int {
        let p = month.split(separator: "-")
        guard p.count >= 2, let y = Int(p[0]), let m = Int(p[1]), let first = date(y, m, 1),
              let r = DateUtil.calendar.range(of: .day, in: .month, for: first) else { return 31 }
        return r.count
    }
}

// MARK: - Türkiye resmi tatilleri ve iş günü (tr-holidays.ts)

/// Son ödeme hafta sonuna ya da resmi tatile denk gelirse bankalar onu ilk iş
/// gününe kaydırır. • Sabit tatiller: 1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs,
/// 15 Temmuz, 30 Ağustos, 29 Ekim. • Dini bayramlar (Diyanet takvimi) yıl yıl;
/// arife günleri ve 28 Ekim YARIM gündür — iş günü sayılır. • Listede olmayan
/// yılın dini bayramları bilinmez: yalnız hafta sonu ve sabit tatiller.
public enum TRHolidays {
    static let fixed: Set<String> = ["01-01", "04-23", "05-01", "05-19", "07-15", "08-30", "10-29"]

    /// Bayramın TAM günleri (arife hariç)
    static let religious: [Int: Set<String>] = [
        2024: ["04-10", "04-11", "04-12", "06-16", "06-17", "06-18", "06-19"],
        2025: ["03-30", "03-31", "04-01", "06-06", "06-07", "06-08", "06-09"],
        2026: ["03-20", "03-21", "03-22", "05-27", "05-28", "05-29", "05-30"],
        2027: ["03-09", "03-10", "03-11", "05-16", "05-17", "05-18", "05-19"],
    ]

    public static var years: [Int] { religious.keys.sorted() }

    public static func isHoliday(_ iso: String) -> Bool {
        let year = Int(iso.prefix(4)) ?? 0
        let md = String(iso.dropFirst(5).prefix(5))
        return fixed.contains(md) || (religious[year]?.contains(md) ?? false)
    }

    public static func isBusinessDay(_ iso: String) -> Bool {
        // Web: new Date(iso + 'T00:00:00Z').getUTCDay(); geçersiz tarihte NaN → iş günü sayılır
        let dow = ISODay.weekday(iso)
        return dow != 0 && dow != 6 && !isHoliday(iso)
    }

    public static func addDaysIso(_ iso: String, _ n: Int) -> String { ISODay.add(iso, n) }

    /// Verilen gün iş günüyse kendisi, değilse sonraki ilk iş günü (en çok 15 gün ileri).
    public static func nextBusinessDay(_ iso: String) -> String {
        var d = iso
        var i = 0
        while i < 15 && !isBusinessDay(d) { d = ISODay.add(d, 1); i += 1 }
        return d
    }
}

// MARK: - Döngü tipleri (card-cycles.ts)

/// Son ödeme tatile denk gelirse: 'due' yalnız son ödeme ilk iş gününe kayar;
/// 'both' kesim de aynı gün sayısı kadar kayar; 'none' kaydırma yok.
public enum HolidayRule: String, Sendable, Hashable, CaseIterable {
    case due, both, none
}

public struct CardDays: Hashable, Sendable {
    /// 1–31, kesim günü; nil = takvim ayı sonu
    public var statementDay: Int?
    /// 1–31, sabit son ödeme günü (gapDays yoksa kullanılır); nil = bilinmiyor
    public var dueDay: Int?
    /// Kesimden son ödemeye gün (bankalarda 10). Varsa son ödeme her ay kesim +
    /// fark'tan hesaplanır — ay uzunluğuna göre günü değişir (24 Ocak → 3 Şubat,
    /// 24 Şubat → 6 Mart), bankaların uyguladığı gibi.
    public var gapDays: Int?
    public var holidayRule: HolidayRule?

    public init(statementDay: Int?, dueDay: Int?, gapDays: Int? = nil, holidayRule: HolidayRule? = nil) {
        self.statementDay = statementDay
        self.dueDay = dueDay
        self.gapDays = gapDays
        self.holidayRule = holidayRule
    }
}

/// Kart Takvimi'nde aya özel girilen kesim / son ödeme (PaymentOccurrence).
public struct CycleOverride: Hashable, Sendable {
    public var statementDate: String?
    public var dueDate: String?

    /// Boş metin "girilmemiş" sayılır (web'de `??` boş metni geçirirdi; DB'de boş
    /// metin yazılmıyor, burada güvenli tarafta kalınır).
    public init(statementDate: String? = nil, dueDate: String? = nil) {
        self.statementDate = statementDate.flatMap { $0.isEmpty ? nil : $0 }
        self.dueDate = dueDate.flatMap { $0.isEmpty ? nil : $0 }
    }
}

public struct CardCycle: Hashable, Sendable {
    /// Ödeme ayı 'YYYY-MM' (Ödeme Takibi'nin ay kaydıyla aynı anahtar)
    public var month: String
    /// Dönem başı (önceki kesimin ertesi)
    public var from: String
    /// Kesim tarihi (dönem sonu, dahil)
    public var closing: String
    public var dueDate: String?
    public var closingCustom: Bool
    public var dueCustom: Bool
    /// Tatil / hafta sonu nedeniyle nominal günden kaydırıldı
    public var closingShifted: Bool
    public var dueShifted: Bool
    /// Kesim son ödemeden önce değil — büyük olasılıkla yanlış girilmiş
    public var invalid: Bool

    public init(month: String, from: String, closing: String, dueDate: String?,
                closingCustom: Bool = false, dueCustom: Bool = false,
                closingShifted: Bool = false, dueShifted: Bool = false, invalid: Bool = false) {
        self.month = month
        self.from = from
        self.closing = closing
        self.dueDate = dueDate
        self.closingCustom = closingCustom
        self.dueCustom = dueCustom
        self.closingShifted = closingShifted
        self.dueShifted = dueShifted
        self.invalid = invalid
    }
}

// MARK: - Döngü hesabı (card-cycles.ts)

/// Tek doğruluk kaynağı: Kart Takvimi, hesap sayfasındaki ekstre ve Ödeme
/// Takibi tarihleri buradan alır. Döngü ÖDEME AYIYLA anılır: "2026-10" = son
/// ödemesi Ekim'de olan ekstre (kesimi Eylül'de de olabilir — kesim 24, son
/// ödeme 4 — Ekim'de de — kesim 11, son ödeme 16).
///   son ödeme = o ayın özel tarihi ?? ayın varsayılan son ödeme günü
///   kesim     = o ayın özel tarihi ?? son ödemeden ÖNCEKİ son varsayılan kesim
///   dönem     = önceki döngünün kesiminin ertesi günü → bu kesim
/// Kesim günü girilmemişse takvim ayı sonu sayılır. Son ödeme günü bilinmiyorsa
/// döngü kesim ayıyla anılır ve son ödeme boş kalır — varsayım yapılmaz.
public enum CardCycles {
    static func pad(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }

    public static func shiftMonthKey(_ month: String, _ delta: Int) -> String {
        let p = month.split(separator: "-")
        guard p.count >= 2, let y = Int(p[0]), let m = Int(p[1]) else { return month }
        let idx = y * 12 + (m - 1) + delta
        let year = Int((Double(idx) / 12).rounded(.down))
        return "\(year)-\(pad(idx - year * 12 + 1))"
    }

    /// Ayın `day`'i, kısa ayda ay sonuna sıkıştırılmış.
    public static func dayOf(_ month: String, _ day: Int) -> String {
        "\(month)-\(pad(min(max(1, day), ISODay.daysIn(month))))"
    }

    /// `before` tarihinden ÖNCEKİ son kesim günü.
    public static func lastClosingBefore(_ before: String, _ statementDay: Int?) -> String {
        let month = String(before.prefix(7))
        let day = statementDay ?? 31
        let same = dayOf(month, day)
        return same < before ? same : dayOf(shiftMonthKey(month, -1), day)
    }

    /// Tatil kuralı uygulanmamış tarihler. Fark modunda ödeme ayı M'nin ekstresi,
    /// kesim günü + fark 30'u aşıyorsa bir önceki ayın kesimidir (24 + 10 → Eylül
    /// kesimi Ekim'de ödenir), aşmıyorsa aynı ayınki (11 + 10 → Ekim'de kesilip
    /// ödenir) — her ödeme ayına tam bir ekstre düşer.
    static func nominal(_ days: CardDays, _ month: String) -> (closing: String, due: String?) {
        // Web: `days.gapDays && days.statementDay` — 0 da "yok" sayılır
        if let gap = days.gapDays, gap != 0, let sd = days.statementDay, sd != 0 {
            let closingMonth = shiftMonthKey(month, sd + gap > 30 ? -1 : 0)
            let closing = dayOf(closingMonth, sd)
            return (closing, ISODay.add(closing, gap))
        }
        let due: String? = if let dd = days.dueDay, dd != 0 { dayOf(month, dd) } else { nil }
        let closing = due.map { lastClosingBefore($0, days.statementDay) } ?? dayOf(month, days.statementDay ?? 31)
        return (closing, due)
    }

    static func withHolidayRule(_ n: (closing: String, due: String?), _ rule: HolidayRule?)
        -> (closing: String, due: String?, closingShifted: Bool, dueShifted: Bool) {
        guard let nDue = n.due, let rule, rule != .none else { return (n.closing, n.due, false, false) }
        if rule == .due {
            let due = TRHolidays.nextBusinessDay(nDue)
            return (n.closing, due, false, due != nDue)
        }
        var closing = n.closing, due = nDue
        var i = 0
        while i < 15 && !TRHolidays.isBusinessDay(due) {
            closing = ISODay.add(closing, 1); due = ISODay.add(due, 1); i += 1
        }
        return (closing, due, closing != n.closing, due != nDue)
    }

    static func closingAndDue(_ days: CardDays, _ month: String, _ ov: CycleOverride?)
        -> (closing: String, dueDate: String?, closingCustom: Bool, dueCustom: Bool, closingShifted: Bool, dueShifted: Bool) {
        let n = withHolidayRule(nominal(days, month), days.holidayRule)
        let sOv = ov?.statementDate, dOv = ov?.dueDate
        return (sOv ?? n.closing, dOv ?? n.due, sOv != nil, dOv != nil,
                sOv == nil && n.closingShifted, dOv == nil && n.dueShifted)
    }

    /// Tek ayın döngüsü; dönem başı için önceki ayın (özel tarihli olabilir) kesimi kullanılır.
    public static func cardCycle(_ days: CardDays, _ month: String,
                                 override: CycleOverride? = nil, prevOverride: CycleOverride? = nil) -> CardCycle {
        let cur = closingAndDue(days, month, override)
        let prev = closingAndDue(days, shiftMonthKey(month, -1), prevOverride)
        return CardCycle(
            month: month, from: ISODay.add(prev.closing, 1), closing: cur.closing, dueDate: cur.dueDate,
            closingCustom: cur.closingCustom, dueCustom: cur.dueCustom,
            closingShifted: cur.closingShifted, dueShifted: cur.dueShifted,
            invalid: cur.dueDate.map { cur.closing >= $0 } ?? false
        )
    }

    /// `from`–`to` arası (dahil) ardışık döngüler. `overrides`: ödeme ayı → özel tarih.
    public static func cardCycles(_ days: CardDays, overrides: [String: CycleOverride] = [:],
                                  from: String, to: String) -> [CardCycle] {
        var out: [CardCycle] = []
        var m = from
        while m <= to {
            out.append(cardCycle(days, m, override: overrides[m], prevOverride: overrides[shiftMonthKey(m, -1)]))
            let next = shiftMonthKey(m, 1)
            if next == m { break }   // geçersiz ay anahtarı — sonsuz döngüye girme
            m = next
        }
        return out
    }
}

// MARK: - Bankaların kesim / son ödeme kuralları (bank-rules.ts)

/// Yasa: hesap kesim ile son ödeme arasında on günden az süre olamaz (5464
/// sayılı Kanun md. 26). Bankalar pratikte tam 10 gün uygular.
/// Tatil: son ödeme hafta sonuna / resmi tatile denk gelirse ilk iş gününe kayar.
///   • 'due'  — yalnız son ödeme kayar, kesim yerinde kalır.
///   • 'both' — kesim ve son ödeme BİRLİKTE kayar, fark hep 10 gün (VakıfBank).
public struct BankRule: Hashable, Sendable {
    public var key: String
    public var label: String
    public var gapDays: Int
    public var holidayRule: HolidayRule
    public var note: String
}

/// Girilmiş son ödeme günü kesime göre olağan dışı (yasal 10 günün altı ya da 15+).
public struct CardDaysInconsistency: Hashable, Sendable {
    public var gap: Int
    public var suggestDue: Int
    public var suggestClosing: Int

    public init(gap: Int, suggestDue: Int, suggestClosing: Int) {
        self.gap = gap
        self.suggestDue = suggestDue
        self.suggestClosing = suggestClosing
    }
}

public struct ResolvedCard: Hashable, Sendable {
    public var days: CardDays
    public var rule: BankRule
    public var inconsistent: CardDaysInconsistency?
}

public enum BankRules {
    public static let minGap = 10
    public static let maxGap = 15

    static let defaultNote = "Kesimden 10 gün sonra; son ödeme tatile denk gelirse ilk iş günü."

    static func r(_ key: String, _ label: String, _ holiday: HolidayRule = .due, _ note: String = defaultNote) -> BankRule {
        BankRule(key: key, label: label, gapDays: 10, holidayRule: holiday, note: note)
    }

    /// Web'deki RULES tablosu, sırası korunarak (ilk eşleşen kazanır).
    static let rules: [(pattern: String, rule: BankRule)] = [
        ("vakif", r("vakif", "VakıfBank", .both,
            "Kesimden 10 gün sonra; son ödeme tatile denk gelecekse kesim de aynı gün sayısı kadar ileri kayar (VakıfBank tarih tablosu).")),
        ("garanti|bonus|miles.?smiles|shop.?fly", r("garanti", "Garanti BBVA")),
        ("yapi ?kredi|world ?card|adios", r("yapikredi", "Yapı Kredi")),
        ("qnb|finansbank|cardfinans|enpara", r("qnb", "QNB")),
        ("kuveyt", r("kuveyt", "Kuveyt Türk")),
        ("odea", r("odea", "Odeabank")),
        ("burgan", r("burgan", "Burgan Bank")),
        ("is ?bank|maximum|isbank", r("isbank", "İş Bankası")),
        ("akbank|axess|wings", r("akbank", "Akbank")),
        ("ziraat|bankkart", r("ziraat", "Ziraat")),
        ("halk|paraf", r("halkbank", "Halkbank")),
        ("deniz", r("denizbank", "DenizBank")),
    ]

    public static let fallback = r("other", "Diğer banka")

    /// Web src/lib/auto-category.ts `foldText`: tr-TR küçük harf, boşluk
    /// sadeleştirme, sonra Türkçe harfler ASCII karşılığına (ı ş ğ ü ö ç â î û).
    public static func foldText(_ s: String) -> String {
        let lowered = s.lowercased(with: Locale(identifier: "tr_TR"))
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let map: [Character: Character] = ["ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c", "â": "a", "î": "i", "û": "u"]
        return String(lowered.map { map[$0] ?? $0 })
    }

    /// Kart adından banka kuralı (bulunamazsa genel kural).
    public static func bankRuleFor(_ cardName: String) -> BankRule {
        let n = foldText(cardName)
        return rules.first { n.range(of: $0.pattern, options: .regularExpression) != nil }?.rule ?? fallback
    }

    /// Kesim günü + fark → ayın nominal son ödeme günü (30 günlük ay yaklaşımı).
    public static func nominalDueDay(_ statementDay: Int, _ gapDays: Int) -> Int {
        ((statementDay + gapDays - 1) % 30) + 1
    }

    /// Kesimden son ödemeye gün sayısı (girilen iki gün arasından, 30 günlük ay).
    public static func gapBetween(_ statementDay: Int, _ dueDay: Int) -> Int {
        let g = (dueDay - statementDay + 30) % 30
        return g == 0 ? 30 : g
    }

    /// Kartın geçerli günleri:
    ///  • fark (gapDays): kartta kayıtlıysa o; değilse girilmiş son ödeme günü
    ///    kesime göre tam bankanın farkıysa ondan türetilir; son ödeme hiç
    ///    girilmemişse banka kuralı (10). Fark varsa son ödeme her ay kesim +
    ///    fark'tan hesaplanır.
    ///  • 11–15 gün → girilen sabit gün korunur (bankadan okunmuş olabilir).
    ///  • Olağan dışı bir son ödeme günü (ör. kesim 11, son ödeme 16) aynen
    ///    kullanılır ama `inconsistent` ile işaretlenir.
    public static func resolveCardDays(account: Account, plan: PaymentPlan?) -> ResolvedCard {
        resolveCardDays(name: account.name, statementDay: account.statementDay,
                        dueGapDays: account.dueGapDays, holidayRule: account.holidayRule,
                        planDayOfMonth: plan?.dayOfMonth)
    }

    public static func resolveCardDays(name: String, statementDay: Int?, dueGapDays: Int?,
                                       holidayRule: String?, planDayOfMonth: Int?) -> ResolvedCard {
        let rule = bankRuleFor(name)
        let sd = statementDay
        let dueDay = planDayOfMonth
        // DB CHECK ('due','both'); tanınmayan değer banka kuralına düşer
        let hRule = holidayRule.flatMap(HolidayRule.init(rawValue:)) ?? rule.holidayRule
        var gapDays = dueGapDays
        var inconsistent: CardDaysInconsistency?

        if gapDays == nil, let sd {
            if let dueDay {
                let g = gapBetween(sd, dueDay)
                if g == rule.gapDays { gapDays = g }
                else if g < minGap || g > maxGap {
                    inconsistent = CardDaysInconsistency(
                        gap: g,
                        suggestDue: nominalDueDay(sd, rule.gapDays),
                        suggestClosing: ((dueDay - rule.gapDays - 1 + 60) % 30) + 1
                    )
                }
            } else {
                gapDays = rule.gapDays
            }
        }
        return ResolvedCard(days: CardDays(statementDay: sd, dueDay: dueDay, gapDays: gapDays, holidayRule: hRule),
                            rule: rule, inconsistent: inconsistent)
    }
}
