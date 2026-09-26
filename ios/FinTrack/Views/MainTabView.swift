import SwiftUI
import FinTrackCore
import FinTrackData

struct MainTabView: View {
    @Environment(AppModel.self) private var model
    @State private var tab: Tab = Self.initialTab
    @State private var quickAdd = Self.debugArg("-quickadd")

    private static func debugArg(_ a: String) -> Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(a)
        #else
        return false
        #endif
    }

    enum Tab: String { case summary, transactions, accounts, budgets }

    /// DEBUG: `-tab transactions` ile açılış sekmesi (simülatör ekran doğrulaması).
    private static var initialTab: Tab {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-tab"), i + 1 < args.count, let t = Tab(rawValue: args[i + 1]) { return t }
        #endif
        return .summary
    }

    var body: some View {
        TabView(selection: $tab) {
            SummaryView(quickAdd: $quickAdd, openTab: { tab = $0 })
                .tabItem { Label("Özet", systemImage: "square.grid.2x2") }
                .tag(Tab.summary)
            TransactionsView(quickAdd: $quickAdd)
                .tabItem { Label("İşlemler", systemImage: "list.bullet.rectangle") }
                .tag(Tab.transactions)
            AccountsView()
                .tabItem { Label("Hesaplar", systemImage: "building.columns") }
                .tag(Tab.accounts)
            BudgetsView()
                .tabItem { Label("Bütçeler", systemImage: "chart.pie") }
                .tag(Tab.budgets)
        }
        .sheet(isPresented: $quickAdd) {
            TransactionFormView(editing: nil)
        }
    }
}

/// Araç çubuğundaki "+" — hızlı ekleme.
struct AddButton: View {
    @Binding var isPresented: Bool
    var body: some View {
        Button { isPresented = true } label: {
            Image(systemName: "plus")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Theme.onAccent)
                .frame(width: 32, height: 32)
                .background(Theme.accent, in: Circle())
        }
        .accessibilityLabel("İşlem ekle")
    }
}

/// Bağlantı / eşitleme hatası şeridi.
struct SyncErrorBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let e = model.lastError {
            HStack(spacing: 8) {
                Image(systemName: "wifi.exclamationmark")
                Text(e).font(.footnote)
                Spacer()
                Button("Tekrar dene") { Task { await model.refresh() } }.font(.footnote.bold())
            }
            .padding(12)
            .background(Theme.warning.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        }
    }
}
