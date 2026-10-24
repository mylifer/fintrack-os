import Foundation

/// Kurlar — web src/lib/utils/fx.ts karşılığı. Web global bir değişken
/// kullanıyor; burada değer tipi olarak dolaştırılır (test edilebilir, eşzamanlılık
/// güvenli). Temel para birimi TRY.
public struct FXRates: Hashable, Sendable {
    public var usdTry: Double
    public var eurTry: Double
    public var gbpTry: Double

    public init(usdTry: Double, eurTry: Double, gbpTry: Double) {
        self.usdTry = usdTry
        self.eurTry = eurTry
        self.gbpTry = gbpTry
    }
}

public struct FX: Sendable {
    public var rates: FXRates?
    public init(rates: FXRates? = nil) { self.rates = rates }

    /// 1 birim `currency` = ? TRY; kur yoksa nil.
    public func rate(_ currency: CurrencyCode) -> Double? {
        if currency == .TRY { return 1 }
        guard let r = rates else { return nil }
        switch currency {
        case .USD: return r.usdTry
        case .EUR: return r.eurTry
        case .GBP: return r.gbpTry
        case .TRY: return 1
        }
    }

    /// Kur yoksa ham tutar (okuma için kasıtlı degrade — web toBaseTry).
    public func toBaseTry(_ amount: Double, _ currency: CurrencyCode) -> Double {
        guard let r = rate(currency) else { return amount }
        return Money.mul(amount, r)
    }

    /// KALICI yazılacak amountTry: kur yoksa nil (ham değer damgalanmaz — web baseSnapshot).
    public func baseSnapshot(_ amount: Double, _ currency: CurrencyCode) -> Double? {
        rate(currency) == nil ? nil : toBaseTry(amount, currency)
    }

    public func fromBaseTry(_ amountTry: Double, _ currency: CurrencyCode) -> Double {
        guard let r = rate(currency), r != 0 else { return amountTry }
        return Money.mul(amountTry, 1 / r)
    }

    /// İşlemin TRY değeri: snapshot varsa o, yoksa canlı çeviri.
    public func baseAmount(_ t: Transaction) -> Double {
        t.amountTry ?? toBaseTry(t.amount, t.currency)
    }
}
