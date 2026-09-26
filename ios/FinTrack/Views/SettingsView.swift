import SwiftUI
import FinTrackCore
import FinTrackData

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @AppStorage("fintrack.amountsHidden") private var amountsHidden = false
    @State private var confirmSignOut = false

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
                    Toggle("Tutarları gizle", isOn: $amountsHidden)
                } header: {
                    Text("Gizlilik")
                } footer: {
                    Text("Kilit açıkken uygulama arka plana geçince kilitlenir.")
                }

                Section("Eşitleme") {
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
                    if let e = model.email { LabeledContent("Hesap", value: e) }
                    Button("Çıkış yap", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("Toplu içe aktarma, yedekleme, raporlar ve diğer ayarlar web'de.")
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
                Text("Bu cihazdaki önbellek silinir. Verileriniz bulutta kalır.")
            }
        }
    }
}
