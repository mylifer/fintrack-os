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

/// Bağlantı / eşitleme durumu şeridi: hata ya da gönderilmeyi bekleyen değişiklikler.
struct SyncErrorBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let e = model.lastError {
            banner(icon: "wifi.exclamationmark", text: e, color: Theme.warning)
        } else if model.pendingWrites > 0 {
            banner(icon: "icloud.and.arrow.up",
                   text: "\(model.pendingWrites) değişiklik bağlantı gelince gönderilecek.",
                   color: Theme.planned)
        }
    }

    private func banner(icon: String, text: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
            Text(text).font(.footnote)
            Spacer()
            if model.isRefreshing {
                ProgressView().controlSize(.small)
            } else {
                Button("Tekrar dene") { Task { await model.refresh() } }.font(.footnote.bold())
            }
        }
        .padding(12)
        .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}
