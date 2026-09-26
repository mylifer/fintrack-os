import Foundation
import FinTrackCore

/// Piyasa fiyatları — web'in sunucu rotalarıyla AYNI ücretsiz, anahtarsız kaynaklar:
///   • kurlar: fawazahmed0 currency-api (bugün + önceki gün)       — /api/prices
///   • altın: Yahoo GC=F spot → gram = ons / 31,1035 × USD/TRY; ziynetler gramdan
///     çarpanla (canlı sitenin fiilen gösterdiği değer — aşağıdaki nota bakın) — /api/prices
///   • TEFAS fonları: tefas.gov.tr fonFiyatBilgiGetir               — /api/prices/tefas
///   • BIST / kripto: Yahoo Finance chart (kripto USD × USD/TRY)   — /api/prices/market
/// Web rotaları tarayıcı oturum çerezi istediği için iOS kaynaklara doğrudan gider.
public enum PricesService {
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 10
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()
    static let ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

    static func getJSON(_ url: String, headers: [String: String] = [:]) async -> Any? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u)
        req.setValue(ua, forHTTPHeaderField: "User-Agent")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    // MARK: Kurlar

    static func isoDate(_ daysAgo: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let d = cal.date(byAdding: .day, value: -daysAgo, to: Date())!
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    static func usdRates(_ tag: String) async -> [String: Double]? {
        let urls = tag == "latest"
            ? ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
               "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json"]
            : ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@\(tag)/v1/currencies/usd.min.json",
               "https://\(tag).currency-api.pages.dev/v1/currencies/usd.min.json"]
        for u in urls {
            if let o = await getJSON(u) as? [String: Any], let usd = o["usd"] as? [String: Double],
               usd["try"] != nil, usd["eur"] != nil, usd["gbp"] != nil {
                return usd
            }
        }
        return nil
    }

    static func firstRates(_ tags: [String]) async -> [String: Double]? {
        for t in tags { if let r = await usdRates(t) { return r } }
        return nil
    }

    // MARK: Altın
    //
    // Web /api/prices önce truncgil (Kapalıçarşı ALIŞ) kotasyonunu dener, alamazsa
    // spot fiyattan türetir. Canlı sitede (Vercel sunucusu) truncgil'e ulaşılamıyor
    // ve web fiilen spot türetmeyi gösteriyor; kullanıcı web'deki değerleri doğru
    // kabul etti (2026-09-27). iOS bu yüzden truncgil'i HİÇ kullanmaz — cihazdan
    // truncgil'e ulaşılabildiği için kullansaydı web ile ~%1,7 farklı çıkardı.
    // Web'in altın kaynağı değişirse burası da birlikte değişmeli.

    static func goldUsd() async -> (current: Double, prev: Double)? {
        guard let o = await getJSON("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2d") as? [String: Any],
              let meta = ((o["chart"] as? [String: Any])?["result"] as? [[String: Any]])?.first?["meta"] as? [String: Any],
              let cur = meta["regularMarketPrice"] as? Double, cur > 0 else { return nil }
        let prev = (meta["chartPreviousClose"] as? Double).flatMap { $0 > 0 ? $0 : nil } ?? cur
        return (cur, prev)
    }

    // MARK: Temel fiyatlar (web /api/prices GET birebir)

    static func basePrices() async -> PriceBook? {
        async let curR = firstRates(["latest", isoDate(0), isoDate(1)])
        async let prevR = firstRates([isoDate(1), isoDate(2), isoDate(3)])
        async let goldR = goldUsd()
        guard let cur = await curR, let tryR = cur["try"], let eur = cur["eur"], let gbp = cur["gbp"] else { return nil }
        let prev = await prevR, gold = await goldR

        var b = PriceBook()
        b.usdTry = tryR
        b.eurTry = tryR / eur
        b.gbpTry = tryR / gbp
        if let p = prev, let pt = p["try"], let pe = p["eur"], let pg = p["gbp"] {
            b.prevUsdTry = pt; b.prevEurTry = pt / pe; b.prevGbpTry = pt / pg
        }
        func gram(_ oz: Double, _ usdTry: Double) -> Double { oz / 31.1035 * usdTry }

        if let g = gold { b.goldGramTry = gram(g.current, tryR) }
        else if let xau = cur["xau"], xau > 0 { b.goldGramTry = tryR / (xau * 31.1035) }

        if let g = gold, let pu = b.prevUsdTry { b.prevGoldGramTry = gram(g.prev, pu) }
        else if let p = prev, let xau = p["xau"], xau > 0, let pt = p["try"] { b.prevGoldGramTry = pt / (xau * 31.1035) }

        func fromGram(_ m: Double) -> Double? { b.goldGramTry > 0 ? b.goldGramTry * m : nil }
        func prevFromGram(_ m: Double) -> Double? { b.prevGoldGramTry.map { $0 * m } }
        b.goldQuarterTry = fromGram(1.6067)
        b.prevGoldQuarterTry = prevFromGram(1.6067)
        b.goldHalfTry = fromGram(3.2133)
        b.prevGoldHalfTry = prevFromGram(3.2133)
        b.goldFullTry = fromGram(6.4267)
        b.prevGoldFullTry = prevFromGram(6.4267)
        b.bilezikGramTry = fromGram(0.916)
        b.prevBilezikGramTry = prevFromGram(0.916)
        return b
    }

    // MARK: TEFAS

    static func tefasFund(_ code: String) async -> PriceBook.Quote? {
        guard let url = URL(string: "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
        req.setValue(ua, forHTTPHeaderField: "User-Agent")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["fonKodu": code, "dil": "TR", "periyod": 1])
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = body["resultList"] as? [[String: Any]] else { return nil }
        var byDate: [String: Double] = [:]
        for r in rows {
            if let t = r["tarih"] as? String, t.count == 10, let p = r["fiyat"] as? Double, p > 0 { byDate[t] = p }
        }
        let pts = byDate.sorted { $0.key < $1.key }
        guard let last = pts.last else { return nil }
        let prev = pts.count > 1 ? pts[pts.count - 2].value : nil
        return .init(name: rows.first?["fonUnvan"] as? String ?? code, price: last.value, prevPrice: prev, date: last.key)
    }

    // MARK: Yahoo (hisse / kripto)

    struct Chart { var name: String; var price: Double; var prevPrice: Double?; var date: String }

    static func yahooChart(_ symbol: String) async -> Chart? {
        let enc = symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? symbol
        guard let o = await getJSON("https://query1.finance.yahoo.com/v8/finance/chart/\(enc)?interval=1d&range=5d") as? [String: Any],
              let r = ((o["chart"] as? [String: Any])?["result"] as? [[String: Any]])?.first,
              let meta = r["meta"] as? [String: Any],
              let price = meta["regularMarketPrice"] as? Double, price > 0 else { return nil }
        let off = meta["gmtoffset"] as? Double ?? 0
        func localDay(_ ts: Double) -> String {
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "UTC")!
            let c = cal.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ts + off))
            return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
        }
        let ts = r["timestamp"] as? [Double] ?? []
        let closes = (((r["indicators"] as? [String: Any])?["quote"] as? [[String: Any]])?.first?["close"] as? [Any]) ?? []
        var byDate: [String: Double] = [:]
        for (i, t) in ts.enumerated() where i < closes.count {
            if let c = closes[i] as? Double, c > 0 { byDate[localDay(t)] = c }
        }
        let date = (meta["regularMarketTime"] as? Double).map(localDay) ?? DateUtil.today()
        if byDate[date] == nil { byDate[date] = price }
        let prev = byDate.filter { $0.key < date }.max { $0.key < $1.key }?.value
        let name = ((meta["shortName"] as? String) ?? (meta["longName"] as? String) ?? symbol)
            .trimmingCharacters(in: .whitespaces)
        return Chart(name: name, price: price, prevPrice: prev, date: date)
    }

    static func marketQuote(_ asset: String, usdTry: Chart?) async -> PriceBook.Quote? {
        let sym = Asset.code(asset)
        if Asset.kind(asset) == .stock {
            guard let c = await yahooChart("\(sym).IS") else { return nil }
            return .init(name: c.name, price: c.price, prevPrice: c.prevPrice, date: c.date)
        }
        guard let c = await yahooChart("\(sym)-USD"), let fx = usdTry else { return nil }
        let prevFx = fx.prevPrice ?? fx.price
        let name = c.name.replacingOccurrences(of: #"\s+USD$"#, with: "", options: [.regularExpression, .caseInsensitive])
        return .init(name: name, price: c.price * fx.price, prevPrice: c.prevPrice.map { $0 * prevFx }, date: c.date)
    }

    // MARK: Hepsi

    /// Temel fiyatlar + portföydeki fon/hisse/kripto kotasyonları. Alınamayan
    /// kotasyon önceki değerinden (`previous`) korunur — ağ hatasında portföy sıfırlanmasın.
    public static func fetch(assets: Set<String>, previous: PriceBook?) async -> PriceBook? {
        async let baseR = basePrices()
        let funds = assets.filter { Asset.kind($0) == .fund }.map(Asset.code)
        let markets = assets.filter { [.stock, .crypto].contains(Asset.kind($0)) }
        let needFx = markets.contains { Asset.kind($0) == .crypto }
        let usdTry = needFx ? await yahooChart("TRY=X") : nil

        var quotes = previous?.quotes ?? [:]
        await withTaskGroup(of: (String, PriceBook.Quote?).self) { group in
            for code in funds { group.addTask { (code, await tefasFund(code)) } }
            for a in markets { group.addTask { (a, await marketQuote(a, usdTry: usdTry)) } }
            for await (key, q) in group { if let q { quotes[key] = q } }
        }

        var book: PriceBook
        if var fresh = await baseR {
            fresh.updatedAt = Date()
            book = fresh
        } else if let previous {
            book = previous                 // temel fiyatlar alınamadı: eski değer ve eski zaman damgası
        } else {
            return nil
        }
        book.quotes = quotes
        return book
    }
}
