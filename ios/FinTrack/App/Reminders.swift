import Foundation
import UserNotifications
import FinTrackCore
import FinTrackData

/// Yerel hatırlatmalar — sunucu yok; uygulama her eşitlemede önümüzdeki 14 günü
/// yeniden planlar. Kart son ödemesi: bir gün önce ve günü sabahı; tekrarlayan ve
/// planlı işlem: günü sabahı. "Tutarları gizle" açıksa bildirimde tutar olmaz
/// (kilit ekranında görünür).
@MainActor
enum Reminders {
    static let enabledKey = "fintrack.remindersEnabled"
    private static let prefix = "fintrack.reminder."
    private static let hour = 9

    static var isEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

    /// İzin ister; verilirse açar. Döner: açık mı.
    static func enable() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        UserDefaults.standard.set(granted, forKey: enabledKey)
        return granted
    }

    static func disable() async {
        UserDefaults.standard.set(false, forKey: enabledKey)
        await clear()
    }

    static func clear() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    /// Bekleyen FinTrack hatırlatmalarını silip yeniden kur.
    static func reschedule(_ model: AppModel) async {
        guard isEnabled, model.userId != nil else { await clear(); return }
        await clear()
        let center = UNUserNotificationCenter.current()
        let now = Date()
        var count = 0
        for u in model.upcoming(days: 14) + dueToday(model) {
            for (offset, text) in lines(u) {
                guard count < 40,
                      let day = DateUtil.parseDay(u.date),
                      let at = DateUtil.calendar.date(byAdding: .day, value: -offset, to: day),
                      let fire = DateUtil.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: at),
                      fire > now else { continue }
                let content = UNMutableNotificationContent()
                content.title = text.title
                content.body = text.body
                content.sound = .default
                content.userInfo = ["url": url(u)]
                content.threadIdentifier = "fintrack.\(u.kind)"
                let comps = DateUtil.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
                let req = UNNotificationRequest(identifier: "\(prefix)\(u.id).\(offset)", content: content,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
                try? await center.add(req)
                count += 1
            }
        }
    }

    /// Bugün son ödemesi olan ekstreler `upcoming` içinde; bugünün tekrarlayanları
    /// ise onay bekleyenlerde — saat 9'dan önce açılırsa onlar da hatırlatılır.
    private static func dueToday(_ model: AppModel) -> [AppModel.Upcoming] {
        let today = DateUtil.today()
        return model.dueRecurring.filter { $0.nextDueDate == today }.map {
            .init(id: "r:\($0.id):\(today)", kind: .recurring, title: $0.name, date: today,
                  amount: $0.amount, currency: $0.currency, type: $0.type, refId: $0.id)
        }
    }

    private static func amount(_ u: AppModel.Upcoming) -> String {
        Fmt.amountsHidden ? "" : " · \(Fmt.currency(u.amount, u.currency))"
    }

    /// (kaç gün önce, metin)
    private static func lines(_ u: AppModel.Upcoming) -> [(Int, (title: String, body: String))] {
        switch u.kind {
        case .cardDue:
            return [
                (1, ("Yarın kart son ödeme günü", "\(u.title.replacingOccurrences(of: " son ödeme", with: ""))\(amount(u))")),
                (0, ("Bugün kart son ödeme günü", "\(u.title.replacingOccurrences(of: " son ödeme", with: ""))\(amount(u))")),
            ]
        case .recurring:
            return [(0, ("\(u.title) bugün", "Tekrarlayan işlem onay bekliyor\(amount(u)). Kaydetmek için dokun."))]
        case .planned:
            return [(0, ("Planlı işlem bugün", "\(u.title)\(amount(u)) — onaylamak için dokun."))]
        }
    }

    private static func url(_ u: AppModel.Upcoming) -> String {
        switch u.kind {
        case .cardDue: "fintrack://accounts"
        case .recurring, .planned: "fintrack://summary"
        }
    }
}

/// Bildirime dokununca ilgili ekrana yönlendir.
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    static let shared = NotificationRouter()

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let s = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) else { return }
        await MainActor.run { Router.shared.open(url) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions { [.banner, .list] }
}
