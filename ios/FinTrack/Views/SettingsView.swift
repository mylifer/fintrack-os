import SwiftUI
import FinTrackCore
import FinTrackData

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @AppStorage("fintrack.amountsHidden") private var amountsHidden = false
    @State private var confirmSignOut = false
    @State private var remindersOn = Reminders.isEnabled
    @State private var remindersDenied = false

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "—"
        let b = info?["CFBundleVersion"] as? String ?? "—"
        return "\(v) (\(b))"
    }

    var body: some View {
        @Bindable var lock = lock
        NavigationStack {
            Form {
                if model.workspaces.count > 1 {
                    Section("Çalışma alanı") {
                        Picker("Aktif alan", selection: Binding(
                            get: { model.activeWorkspaceId ?? "" },
                            set: { model.setActiveWorkspace($0) }
                        )) {
                            ForEach(model.workspaces) { Text($0.name).tag($0.id) }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }

                Section {
                    Toggle("\(lock.biometryName) kilidi", isOn: $lock.isEnabled)
                    if lock.isEnabled {
                        Picker("Kilitle", selection: $lock.graceSeconds) {
                            ForEach(AppLock.graceOptions, id: \.seconds) { Text($0.label).tag($0.seconds) }
                        }
                    }
                    Toggle("Tutarları gizle", isOn: $amountsHidden)
                } header: {
                    Text("Gizlilik")
                } footer: {
                    Text("Uygulama arka planda seçilen süreden uzun kalınca kilitlenir. Uygulama değiştiricide içerik her zaman gizlenir.")
                }

                Section {
                    Toggle("Hatırlatmalar", isOn: Binding(get: { remindersOn }, set: { v in
                        Task {
                            if v {
                                remindersOn = await Reminders.enable()
                                remindersDenied = !remindersOn
                                if remindersOn { await Reminders.reschedule(model) }
                            } else {
                                await Reminders.disable()
                                remindersOn = false
                            }
                        }
                    }))
                } header: {
                    Text("Bildirimler")
                } footer: {
                    Text(remindersDenied
                         ? "Bildirim izni verilmedi. iPhone Ayarlar → FinTrack → Bildirimler'den açabilirsiniz."
                         : "Kart son ödeme günü (bir gün önce ve günü), tekrarlayan ve planlı işlemler için sabah 9'da hatırlatır. \"Tutarları gizle\" açıksa tutar yazılmaz.")
                }

                Section("Eşitleme") {
                    if model.pendingWrites > 0 {
                        LabeledContent("Gönderilmeyi bekleyen", value: "\(model.pendingWrites) değişiklik")
                    }
                    LabeledContent("Son güncelleme") {
                        if let d = model.lastSync {
                            Text(d.formatted(.relative(presentation: .named).locale(Locale(identifier: "tr_TR"))))
                        } else {
                            Text("—")
                        }
                    }
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        HStack {
                            Text("Şimdi güncelle")
                            if model.isRefreshing { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(model.isRefreshing)
                }

                Section {
                    Link(destination: WebLinks.base) {
                        Label("Web'de aç", systemImage: "safari")
                    }
                    Link(destination: WebLinks.payments) {
                        Label("Ödeme Takibi (web)", systemImage: "calendar.badge.checkmark")
                    }
                    Link(destination: WebLinks.cardCalendar) {
                        Label("Kart Takvimi (web)", systemImage: "creditcard")
                    }
                } header: {
                    Text("Web")
                } footer: {
                    Text("Toplu içe aktarma, yedekleme, raporlar, kart kesim/son ödeme günleri ve Ödeme Takibi web'de.")
                }

                Section("Hakkında") {
                    LabeledContent("Sürüm", value: appVersion)
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-demo") {
                        Label("Örnek veri modu — buluta hiçbir şey yazılmaz", systemImage: "testtube.2")
                            .font(.footnote).foregroundStyle(Theme.warning)
                    }
                    #endif
                }

                Section {
                    if let e = model.email { LabeledContent("Hesap", value: e) }
                    Button("Çıkış yap", role: .destructive) { confirmSignOut = true }
                }
            }
            .navigationTitle("Ayarlar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Bitti") { dismiss() } }
            }
            .confirmationDialog("Çıkış yapılsın mı?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Çıkış yap", role: .destructive) {
                    Task {
                        await model.signOut()
                        dismiss()
                    }
                }
            } message: {
                if model.pendingWrites > 0 {
                    Text("\(model.pendingWrites) değişiklik henüz buluta gönderilmedi ve çıkışta kaybolur. Önce internete bağlanıp \"Şimdi güncelle\"ye dokunun.")
                } else {
                    Text("Bu cihazdaki önbellek silinir. Verileriniz bulutta kalır.")
                }
            }
        }
    }
}
