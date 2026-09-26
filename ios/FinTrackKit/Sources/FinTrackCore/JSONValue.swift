import Foundation

/// Supabase satırının ham JSON hali.
///
/// Neden ham satır tutuluyor: web ile aynı tablolara yazıyoruz ve web'in
/// eklediği, iOS'un henüz bilmediği sütunlar (categorySplits, receipt, …)
/// bir düzenlemede kaybolmamalı. Yazarken ham satırın üstüne yalnız iOS'un
/// sahip olduğu sütunlar konur, gerisi olduğu gibi geri gider.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public var string: String? { if case .string(let s) = self { return s }; return nil }
    public var double: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)   // savunma: numeric metin dönerse
        default: return nil
        }
    }
    public var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var array: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    public var object: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    public var isNull: Bool { if case .null = self { return true }; return false }
}

public typealias JSONObject = [String: JSONValue]

extension JSONValue {
    public init(_ s: String?) { self = s.map { .string($0) } ?? .null }
    public init(_ d: Double?) { self = d.map { .number($0) } ?? .null }
    public init(_ b: Bool?) { self = b.map { .bool($0) } ?? .null }
}

extension Dictionary where Key == String, Value == JSONValue {
    func str(_ k: String) -> String? { self[k]?.string }
    func num(_ k: String) -> Double? { self[k]?.double }
    func int(_ k: String) -> Int? { self[k]?.double.map { Int($0) } }
    func flag(_ k: String) -> Bool? { self[k]?.bool }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
                     ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral v: String) { self = .string(v) }
    public init(integerLiteral v: Int) { self = .number(Double(v)) }
    public init(floatLiteral v: Double) { self = .number(v) }
    public init(booleanLiteral v: Bool) { self = .bool(v) }
    public init(nilLiteral: ()) { self = .null }
}
