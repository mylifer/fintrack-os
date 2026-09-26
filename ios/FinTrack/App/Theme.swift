import SwiftUI
import FinTrackCore

/// Web tasarım dili (globals.css): turkuaz aksan (#00D9D9) + katmanlı nötr zemin.
/// Turkuaz parlak — üstündeki yazı koyu (#062626) olmalı; açık zeminde METİN
/// rengi olarak kullanılmaz, yalnız ikon/dolgu/ray. Gelir yeşil, gider kırmızı,
/// planlı/gelecek sky.
enum Theme {
    /// Dolgu/ikon/ray için parlak turkuaz.
    static let accent = Color(hex: "#00D9D9")
    /// Metin ve düğme tonu (tint): açık zeminde okunur koyu turkuaz, koyu zeminde parlak.
    static let tint = Color("AccentColor")
    static let onAccent = Color(hex: "#062626")
    static let income = Color(red: 0.13, green: 0.66, blue: 0.36)
    static let expense = Color(red: 0.86, green: 0.24, blue: 0.24)
    static let planned = Color(hex: "#0EA5E9")
    static let warning = Color(hex: "#F59E0B")
}

extension Color {
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        let v = UInt64(s, radix: 16) ?? 0x6B7280
        self.init(red: Double((v >> 16) & 0xFF) / 255,
                  green: Double((v >> 8) & 0xFF) / 255,
                  blue: Double(v & 0xFF) / 255)
    }
}

/// Web kategori ikonları Tabler adlarıdır ('shopping-cart'); eski satırlarda emoji
/// olabilir. SF Symbols karşılığı yoksa etiket ikonu.
enum Icons {
    private static let tabler: [String: String] = [
        "tools-kitchen-2": "fork.knife", "shopping-cart": "cart", "coffee": "cup.and.saucer",
        "car": "car", "home": "house", "shopping-bag": "bag", "receipt": "doc.text",
        "refresh": "arrow.triangle.2.circlepath", "movie": "film", "building-hospital": "cross.case",
        "shield": "shield", "trending-up": "chart.line.uptrend.xyaxis", "scale": "scalemass",
        "building-bank": "building.columns", "tool": "wrench.and.screwdriver", "smoking": "smoke",
        "sparkles": "sparkles", "package": "shippingbox", "bolt": "bolt", "droplet": "drop",
        "road": "road.lanes", "parking": "parkingsign", "sofa": "sofa", "hammer": "hammer",
        "key": "key", "device-tv": "tv", "spray": "bubbles.and.sparkles", "device-laptop": "laptopcomputer",
        "hanger": "tshirt", "plane": "airplane", "pencil": "pencil", "beer": "mug",
        "device-desktop": "desktopcomputer", "building": "building.2", "flame": "flame",
        "wifi": "wifi", "phone-call": "phone", "briefcase": "briefcase", "arrow-up-right": "arrow.up.right",
        "gift": "gift", "gas-station": "fuelpump", "heart": "heart", "book": "book", "school": "graduationcap",
        "paw": "pawprint", "baby-carriage": "stroller", "cash": "banknote", "credit-card": "creditcard",
        "wallet": "wallet.bifold", "pig-money": "banknote", "music": "music.note", "gamepad": "gamecontroller",
        "barbell": "dumbbell", "pill": "pills", "dental": "mouth", "stethoscope": "stethoscope",
        "bus": "bus", "train": "tram", "bike": "bicycle", "world": "globe", "users": "person.2",
        "user": "person", "tag": "tag", "star": "star", "cake": "birthday.cake", "pizza": "fork.knife",
    ]

    /// (SF Symbol, emoji) — ikisinden biri dolu.
    static func category(_ name: String?) -> (symbol: String?, emoji: String?) {
        guard let name, !name.isEmpty else { return ("tag", nil) }
        if let s = tabler[name] { return (s, nil) }
        if name.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation || $0.value > 0x2000 }) {
            return (nil, name)
        }
        return ("tag", nil)
    }

    static func account(_ type: AccountType) -> String {
        switch type {
        case .cash: "banknote"
        case .checking: "building.columns"
        case .savings: "banknote.fill"
        case .credit_card: "creditcard"
        case .investment: "chart.line.uptrend.xyaxis"
        case .loan: "percent"
        }
    }
}

/// Renkli daire içinde kategori/hesap ikonu.
struct IconBadge: View {
    var symbol: String?
    var emoji: String?
    var color: Color
    var size: CGFloat = 36

    var body: some View {
        ZStack {
            Circle().fill(color.opacity(0.16))
            if let emoji {
                Text(emoji).font(.system(size: size * 0.5))
            } else {
                Image(systemName: symbol ?? "tag")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(color)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

extension View {
    /// Katmanlı kart yüzeyi (web --card).
    func card() -> some View {
        padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
