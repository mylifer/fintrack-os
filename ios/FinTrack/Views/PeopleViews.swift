import SwiftUI
import FinTrackCore
import FinTrackData

/// Web kişileri (aile üyesi / alıcı) seçimi. Kişiler web'de eklenir; o roldeki
/// kişi yoksa satır görünmez. Arşivlenmiş ama seçili kişi listede kalır.
struct PersonPicker: View {
    @Environment(AppModel.self) private var model
    let title: String
    let role: Person.Role
    @Binding var selection: String?

    var body: some View {
        let options = model.pickerPeople(role)
        let current = model.person(selection)
        if !options.isEmpty || current != nil {
            Picker(title, selection: $selection) {
                Text("Yok").tag(String?.none)
                ForEach(options) { Text($0.name).tag(Optional($0.id)) }
                if let current, !options.contains(where: { $0.id == current.id }) {
                    Text("\(current.name) (arşiv)").tag(Optional(current.id))
                }
            }
        }
    }
}
