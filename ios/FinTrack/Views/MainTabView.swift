import SwiftUI
import FinTrackCore
import FinTrackData

struct MainTabView: View {
    @Environment(AppModel.self) private var model
    @Environment(Router.self) private var router

    enum Tab: String { case summary, transactions, accounts, investments, budgets }

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            SummaryView(quickAdd: $router.quickAdd, openTab: { router.tab = $0 })
                .tabItem { Label("Özet", systemImage: "square.grid.2x2") }
                .tag(Tab.summary)
            TransactionsView(quickAdd: $router.quickAdd)
                .tabItem { Label("İşlemler", systemImage: "list.bullet.rectangle") }
                .tag(Tab.transactions)
            AccountsView()
                .tabItem { Label("Hesaplar", systemImage: "building.columns") }
                .tag(Tab.accounts)
            InvestmentsView()
                .tabItem { Label("Yatırımlar", systemImage: "chart.line.uptrend.xyaxis") }
                .tag(Tab.investments)
            PlanView()
                .tabItem { Label("Plan", systemImage: "chart.pie") }
                .badge(model.dueRecurring.count)
                .tag(Tab.budgets)
        }
        .sheet(isPresented: $router.quickAdd) {
            TransactionFormView(editing: nil, template: router.quickAddTemplate)
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
