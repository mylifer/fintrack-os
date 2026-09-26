import SwiftUI
import FinTrackData

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(width: 56, height: 56)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    Text("FinTrack").font(.largeTitle.bold())
                    Text("Web'deki hesabınızla giriş yapın.")
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 48)

                VStack(spacing: 12) {
                    TextField("E-posta", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .fieldStyle()
                    SecureField("Şifre", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .fieldStyle()
                }

                if let e = model.lastError {
                    Label(e, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(Theme.expense)
                }

                Button(action: submit) {
                    Group {
                        if busy { ProgressView().tint(Theme.onAccent) } else { Text("Giriş yap").bold() }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .foregroundStyle(Theme.onAccent)
                .disabled(busy || email.isEmpty || password.isEmpty)

                Text("Hesap oluşturma, şifre sıfırlama ve iki adımlı doğrulama ayarları web'de.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 24)
        }
        .background(Color(.systemGroupedBackground))
        .onAppear { focus = .email }
    }

    private func submit() {
        guard !busy, !email.isEmpty, !password.isEmpty else { return }
        busy = true
        Task {
            await model.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            busy = false
        }
    }
}

struct MFAView: View {
    @Environment(AppModel.self) private var model
    @State private var code = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "lock.shield")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .padding(.top, 48)
            Text("İki adımlı doğrulama").font(.title.bold())
            Text("Doğrulama uygulamanızdaki 6 haneli kodu girin.")
                .foregroundStyle(.secondary)

            TextField("000000", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 32, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .focused($focused)
                .fieldStyle()
                .onChange(of: code) { _, v in
                    let digits = String(v.filter(\.isNumber).prefix(6))
                    if digits != v { code = digits }
                    if digits.count == 6 { submit() }
                }

            if let e = model.lastError {
                Label(e, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Theme.expense)
            }

            Button(action: submit) {
                Group {
                    if busy { ProgressView().tint(Theme.onAccent) } else { Text("Doğrula").bold() }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .foregroundStyle(Theme.onAccent)
            .disabled(busy || code.count != 6)

            Button("Farklı hesapla giriş yap") { Task { await model.signOut() } }
                .frame(maxWidth: .infinity)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Color(.systemGroupedBackground))
        .onAppear { focused = true }
    }

    private func submit() {
        guard !busy, code.count == 6 else { return }
        busy = true
        Task {
            await model.verifyMFA(code: code)
            busy = false
            if model.lastError != nil { code = "" }
        }
    }
}

extension View {
    func fieldStyle() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
