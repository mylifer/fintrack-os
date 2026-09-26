import Foundation
import FinTrackCore

/// Döviz kurları — web /api/prices ile aynı ücretsiz, anahtarsız kaynak
/// (fawazahmed0 currency-api). usdTry = usd.try, eurTry = usd.try / usd.eur, …
public enum RatesService {
    static let urls = [
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
        "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
    ]

    public static func fetch() async -> FXRates? {
        struct Payload: Decodable { let usd: [String: Double] }
        for s in urls {
            guard let url = URL(string: s) else { continue }
            var req = URLRequest(url: url)
            req.timeoutInterval = 6
            req.cachePolicy = .reloadIgnoringLocalCacheData
            guard let (data, resp) = try? await URLSession.shared.data(for: req),
                  (resp as? HTTPURLResponse)?.statusCode == 200,
                  let p = try? JSONDecoder().decode(Payload.self, from: data),
                  let t = p.usd["try"], let e = p.usd["eur"], let g = p.usd["gbp"], e > 0, g > 0
            else { continue }
            return FXRates(usdTry: t, eurTry: t / e, gbpTry: t / g)
        }
        return nil
    }
}
