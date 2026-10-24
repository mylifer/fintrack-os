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

    private static var running: Task<Void, Never>?

    /// Yeniden planla — öncekini iptal ederek (üst üste çalışan iki tur eski
    /// listeden hatırlatma eklemesin).
    static func schedule(_ model: AppModel) {
        let previous = running
        previous?.cancel()
        running = Task {
            await previous?.value   // eski tur tamamen bitsin (ekleme arada kalmasın)
            guard !Task.isCancelled else { return }
            await reschedule(model)
        }
    }

    /// Bekleyen FinTrack hatırlatmalarını silip yeniden kur.
    static func reschedule(_ model: AppModel) async {
        guard isEnabled, model.userId != nil else { await clear(); return }
        await clear()
        let center = UNUserNotificationCenter.current()
        let now = Date()
        var count = 0
        for d in depositReminders(model) {
            guard count < 40, let day = DateUtil.parseDay(d.date),
                  let fire = DateUtil.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day), fire > now
            else { continue }
            let content = UNMutableNotificationContent()
            content.title = d.title
            content.body = d.body
            content.sound = .default
            content.userInfo = ["url": "fintrack://accounts"]
            content.threadIdentifier = "fintrack.deposit"
            let comps = DateUtil.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            if Task.isCancelled { return }
            try? await center.add(UNNotificationRequest(identifier: "\(prefix)\(d.id)", content: content,
                                                        trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            count += 1
        }
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
                if Task.isCancelled { return }
                try? await center.add(req)
                count += 1
            }
        }
    }

    /// Vadesi önümüzdeki 14 gün içinde dolan mevduatlar: vade günü sabahı
    /// (web bildirim merkezi deposit-matured / deposit-upcoming).
    private static func depositReminders(_ model: AppModel) -> [(id: String, date: String, title: String, body: String)] {
        let today = DateUtil.today()
        let limit = DateUtil.calendar.date(byAdding: .day, value: 14, to: Date()).map(DateUtil.day) ?? today
        return model.activeAccounts.compactMap { a in
            guard let t = Deposit.terms(a), t.end >= today, t.end <= limit else { return nil }
            let p = Deposit.project(model.balances[a.id] ?? a.initialBalance, t, asOf: t.end)
            let net = Fmt.amountsHidden ? "" : " Net faiz \(Fmt.currency(p.net, a.currency))."
            return ("d:\(a.id):\(t.end)", t.end, "Vade doldu: \(a.name)", "Vadeli mevduatın vadesi bugün doluyor.\(net) İşlemek için dokun.")
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

/// Bütçe uyarıları (web bildirim merkezi "budget-alert"): bu ay uyarı eşiğini
/// geçen ya da aşılan bütçe için tek seferlik bildirim. Anahtar web'deki gibi
/// bütçe + ay + durum: eşikten aşıma geçen bütçe yeniden bildirilir. İlk
/// çalıştırmada (ve hatırlatmalar kapalıyken) mevcut durumlar sessizce kaydedilir.
@MainActor
enum BudgetAlerts {
    private static let storePrefix = "fintrack.budgetAlertsSeen."

    static func key(_ s: Calc.BudgetState, _ my: MonthYear) -> String {
        "\(s.budget.id):\(my.year)-\(my.month):\(s.status.rawValue)"
    }

    static func check(_ model: AppModel) {
        guard let uid = model.userId, model.derived != nil else { return }
        let my = MonthYear.current()
        let alerts = model.budgetStates(my).filter { $0.status != .ok }
        let keys = alerts.map { key($0, my) }
        let storeKey = storePrefix + uid + "." + (model.activeWorkspaceId ?? "-")
        let stored = UserDefaults.standard.stringArray(forKey: storeKey)
        // Bu ay bildirilenler birikir (harcama düşüp yeniden eşiğe çıkınca tekrar
        // gelmesin); geçen ayların anahtarları atılır
        let monthTag = ":\(my.year)-\(my.month):"
        var seen = Set((stored ?? []).filter { $0.contains(monthTag) })
        defer { UserDefaults.standard.set(Array(seen), forKey: storeKey) }
        guard stored != nil, Reminders.isEnabled else { seen.formUnion(keys); return }
        for (s, k) in zip(alerts, keys) where !seen.contains(k) {
            seen.insert(k)
            // Aşım bildirildiyse (ör. limit sonradan artırıldı) aynı ay "uyarı" gelmez
            let exceededKey = "\(s.budget.id)\(monthTag)\(BudgetStatus.exceeded.rawValue)"
            if s.status == .warning && seen.contains(exceededKey) { continue }
            post(s, key: k, categories: model.categories)
        }
    }

    private static func post(_ s: Calc.BudgetState, key: String, categories: [FinTrackCore.Category]) {
        let label = Calc.budgetLabel(s.budget, categories).label
        let content = UNMutableNotificationContent()
        content.title = s.status == .exceeded ? "Bütçe aşıldı: \(label)" : "Bütçe uyarısı: \(label)"
        let pct = "%\(s.percentUsed.rounded().safeInt) kullanıldı"
        content.body = Fmt.amountsHidden
            ? "\(pct). Ayrıntılar için dokun."
            : "\(pct) · \(Fmt.currency(s.spent)) / \(Fmt.currency(s.limit))"
        content.sound = .default
        content.userInfo = ["url": "fintrack://budgets"]
        content.threadIdentifier = "fintrack.budget"
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "fintrack.budget.\(key)", content: content, trigger: nil))
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
