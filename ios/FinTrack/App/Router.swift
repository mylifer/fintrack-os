import SwiftUI
import FinTrackCore

/// Sekme ve hızlı ekleme durumu — widget bağlantıları (fintrack://…) buradan yönlenir.
@MainActor
@Observable
final class Router {
    var tab: MainTabView.Tab = Router.debugTab ?? .summary
    var quickAdd = Router.debugFlag("-quickadd") {
        didSet { if !quickAdd { quickAddTemplate = nil } }
    }
    /// Hızlı ekleme bir işlemin kopyasıyla açılacaksa doldurulmuş taslak.
    var quickAddTemplate: TransactionDraft?

    /// Var olan işlemin kopyası: aynı alanlar, bugünün tarihi.
    func duplicate(_ t: Transaction) {
        var d = TransactionDraft(editing: t)
        d.date = Date()
        quickAddTemplate = d
        quickAdd = true
    }

    /// fintrack://add · fintrack://budgets · fintrack://summary
    func open(_ url: URL) {
        guard url.scheme == "fintrack" else { return }
        switch url.host {
        case "add": quickAdd = true
        case "budgets": tab = .budgets
        case "investments": tab = .investments
        case "accounts": tab = .accounts
        case "transactions": tab = .transactions
        default: tab = .summary
        }
    }

    // DEBUG: `-tab transactions`, `-quickadd` (simülatör ekran doğrulaması)
    private static var debugTab: MainTabView.Tab? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count { return MainTabView.Tab(rawValue: args[i + 1]) }
        #endif
        return nil
    }

    private static func debugFlag(_ a: String) -> Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(a)
        #else
        return false
        #endif
    }
}
