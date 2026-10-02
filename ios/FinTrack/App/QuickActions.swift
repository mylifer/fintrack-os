import UIKit
import FinTrackCore

/// Ana ekran kısayolları (uygulama simgesine basılı tut): gider / gelir /
/// transfer ekle, bütçeler. Widget bağlantılarıyla aynı yoldan (fintrack://…)
/// yönlenir; uygulama kilitliyse kilit perdesi formun da üstündedir.
enum QuickActions {
    static func install() {
        UIApplication.shared.shortcutItems = [
            item("add-expense", "Gider ekle", "minus.circle"),
            item("add-income", "Gelir ekle", "plus.circle"),
            item("add-transfer", "Transfer", "arrow.left.arrow.right.circle"),
            item("budgets", "Bütçeler", "chart.pie"),
        ]
    }

    private static func item(_ type: String, _ title: String, _ symbol: String) -> UIApplicationShortcutItem {
        UIApplicationShortcutItem(type: type, localizedTitle: title, localizedSubtitle: nil,
                                  icon: UIApplicationShortcutIcon(systemImageName: symbol))
    }

    static func url(for item: UIApplicationShortcutItem) -> URL? {
        switch item.type {
        case "add-expense": URL(string: "fintrack://add?type=expense")
        case "add-income": URL(string: "fintrack://add?type=income")
        case "add-transfer": URL(string: "fintrack://add?type=transfer")
        case "budgets": URL(string: "fintrack://budgets")
        default: nil
        }
    }

    @MainActor static func perform(_ item: UIApplicationShortcutItem) -> Bool {
        guard let url = url(for: item) else { return false }
        Router.shared.open(url)
        return true
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        QuickActions.install()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // Soğuk açılış kısayolu: sahne bağlanırken gelir
        if let item = options.shortcutItem { _ = QuickActions.perform(item) }
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = QuickActionSceneDelegate.self
        return config
    }
}

/// Uygulama arka plandayken seçilen kısayol
final class QuickActionSceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(QuickActions.perform(shortcutItem))
    }
}
