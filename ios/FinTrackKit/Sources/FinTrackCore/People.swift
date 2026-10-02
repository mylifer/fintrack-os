import Foundation

/// Kişiler (web `people`): aile üyeleri ve alıcılar. İşlemler `familyMemberId` /
/// `recipientId` ile bağlanır. iOS kişi eklemez/düzenlemez (web'de); yalnız
/// okur ve işleme atar. Arşivlenen kişinin adı bağlı işlemlerde görünmeye devam eder.
public struct Person: SyncRecord, Hashable {
    public static let table = "people"
    public enum Role: String, Sendable { case familyMember = "family_member", recipient }

    public let raw: JSONObject
    public let id: String
    public let name: String
    public let role: Role
    public let isArchived: Bool

    public init(raw: JSONObject) {
        self.raw = raw
        id = raw.str("id") ?? ""
        name = raw.str("name") ?? ""
        role = Role(rawValue: raw.str("role") ?? "") ?? .recipient
        isArchived = raw.flag("isArchived") ?? false
    }

    public func ownedColumns() -> JSONObject { [:] }   // salt okunur
}
