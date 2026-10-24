import SwiftUI
import PhotosUI
import UIKit
import FinTrackCore
import FinTrackData

/// İşlemin fiş / fatura eki (web ReceiptField): kamerayla çek ya da galeriden
/// seç; görsel 1600 px'e küçültülüp JPEG olarak yüklenir. Görüntülemek için
/// kısa ömürlü bağlantı açılır. İnternet gerekir.
struct ReceiptSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let transaction: Transaction

    @State private var pickerItem: PhotosPickerItem?
    @State private var showCamera = false
    @State private var busy = false
    @State private var errorMessage: String?

    private var current: Transaction { model.transactions.first { $0.id == transaction.id } ?? transaction }

    var body: some View {
        let receipt = current.receipt
        Section {
            if let r = receipt {
                HStack {
                    Image(systemName: r.type == "application/pdf" ? "doc.richtext" : "photo")
                        .foregroundStyle(Theme.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.name).lineLimit(1)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(r.size), countStyle: .file))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if busy { ProgressView() }
                }
                Button { view() } label: { Label("Görüntüle", systemImage: "eye") }
                Button("Fişi kaldır", role: .destructive) { remove() }
            }
            HStack {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCamera = true } label: { Label(receipt == nil ? "Fotoğraf çek" : "Yeniden çek", systemImage: "camera") }
                        .buttonStyle(.borderless)
                    Spacer()
                }
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Label(receipt == nil ? "Galeriden seç" : "Değiştir", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.borderless)
                if receipt == nil && busy { Spacer(); ProgressView() }
            }
        } header: {
            Text("Fiş / fatura")
        } footer: {
            Text("Fotoğraf küçültülerek yüklenir; yalnız siz görebilirsiniz. İnternet gerekir.")
        }
        .disabled(busy)
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                    upload(img)
                }
                pickerItem = nil
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { img in upload(img) }.ignoresSafeArea()
        }
        .alert("Fiş", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("Tamam", role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    /// En uzun kenar 1600 px, JPEG 0,82 (web shrinkImage)
    static func jpeg(_ img: UIImage) -> Data? {
        let maxDim: CGFloat = 1600
        let w = img.size.width, h = img.size.height
        let scale = min(1, maxDim / max(w, h))
        let size = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let out = UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.82)
    }

    private func upload(_ img: UIImage) {
        guard let data = Self.jpeg(img) else { errorMessage = "Görsel işlenemedi."; return }
        busy = true
        Task {
            do {
                let name = "fis-\(DateUtil.day(Date())).jpg"
                try await model.attachReceipt(current, data: data, name: name, contentType: "image/jpeg")
                Haptics.success()
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func view() {
        busy = true
        Task {
            do { if let url = try await model.receiptURL(current) { openURL(url) } }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    private func remove() {
        busy = true
        Task {
            do { try await model.removeReceipt(current); Haptics.success() }
            catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}

/// Kamera (UIImagePickerController)
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = info[.originalImage] as? UIImage { parent.onImage(img) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
