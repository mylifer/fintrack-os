import Foundation

public struct MonthYear: Hashable, Sendable {
    public var month: Int   // 1–12
    public var year: Int
    public init(month: Int, year: Int) { self.month = month; self.year = year }

    public static func current(_ now: Date = Date()) -> MonthYear {
        let c = DateUtil.calendar.dateComponents([.year, .month], from: now)
        return MonthYear(month: c.month!, year: c.year!)
    }

    public var previous: MonthYear {
        month == 1 ? MonthYear(month: 12, year: year - 1) : MonthYear(month: month - 1, year: year)
    }
    public var next: MonthYear {
        month == 12 ? MonthYear(month: 1, year: year + 1) : MonthYear(month: month + 1, year: year)
    }
}

/// Tarihler web'deki gibi yerel saatle "yyyy-MM-dd" metinleridir (date-fns
/// `format(new Date(), 'yyyy-MM-dd')`). Kıyaslama metin sırasıyla yapılır;
/// eski satırlarda tam ISO olabileceği için her zaman ilk 10 karakter alınır.
public enum DateUtil {
    public static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.locale = Locale(identifier: "tr_TR")
        c.firstWeekday = 2
        return c
    }()

    private static func formatter(_ fmt: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = Locale(identifier: "tr_TR")
        f.timeZone = calendar.timeZone
        f.dateFormat = fmt
        return f
    }

    nonisolated(unsafe) private static let dayFormatter = formatter("yyyy-MM-dd")

    public static func day(_ date: Date) -> String { dayFormatter.string(from: date) }
    /// Bugün ("yyyy-MM-dd"). Satır başına çağrılıyor (Calc.isPosted varsayılanı):
    /// biçimleyiciyi her seferinde çalıştırmamak için 1 sn önbellek.
    public static func today() -> String {
        let now = Date().timeIntervalSinceReferenceDate
        todayLock.lock(); defer { todayLock.unlock() }
        if let c = todayCache, now - c.at < 1, now >= c.at { return c.value }
        let v = day(Date())
        todayCache = (v, now)
        return v
    }
    nonisolated(unsafe) private static var todayCache: (value: String, at: TimeInterval)?
    private static let todayLock = NSLock()
    public static func parseDay(_ s: String) -> Date? { dayFormatter.date(from: String(s.prefix(10))) }

    public static func monthRange(_ my: MonthYear) -> (from: String, to: String) {
        let first = calendar.date(from: DateComponents(year: my.year, month: my.month, day: 1))!
        let days = calendar.range(of: .day, in: .month, for: first)!.count
        let last = calendar.date(from: DateComponents(year: my.year, month: my.month, day: days))!
        return (day(first), day(last))
    }

    public static func yearRange(_ year: Int) -> (from: String, to: String) {
        (String(format: "%04d-01-01", year), String(format: "%04d-12-31", year))
    }

    /// Metin aralığı kıyası (ters aralığa toleranslı — web isInRange ile aynı).
    public static func isInRange(_ date: String, _ from: String, _ to: String) -> Bool {
        let d = String(date.prefix(10))
        let (a, b) = from <= to ? (from, to) : (to, from)
        return d >= a && d <= b
    }

    /// "12 Eyl 2026" — geçersiz tarihte ham metin (web formatDate ile aynı).
    public static func display(_ iso: String, _ fmt: String = "d MMM yyyy") -> String {
        guard let d = parseDay(iso) else { return iso }
        return formatter(fmt).string(from: d)
    }

    public static func monthTitle(_ my: MonthYear) -> String {
        let d = calendar.date(from: DateComponents(year: my.year, month: my.month, day: 1))!
        return formatter("LLLL yyyy").string(from: d).capitalized(with: Locale(identifier: "tr_TR"))
    }

    /// İşlem listesi bölüm başlığı: "Bugün", "Dün" ya da "12 Eylül Cumartesi".
    public static func sectionTitle(_ iso: String, today: String = DateUtil.today()) -> String {
        if iso == today { return "Bugün" }
        if let t = parseDay(today), let y = calendar.date(byAdding: .day, value: -1, to: t), iso == day(y) {
            return "Dün"
        }
        if let t = parseDay(today), let tm = calendar.date(byAdding: .day, value: 1, to: t), iso == day(tm) {
            return "Yarın"
        }
        let sameYear = iso.prefix(4) == today.prefix(4)
        return display(iso, sameYear ? "d MMMM EEEE" : "d MMMM yyyy")
    }
}
