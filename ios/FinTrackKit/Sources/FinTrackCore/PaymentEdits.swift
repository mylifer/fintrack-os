import Foundation

/* ── Ödeme Takibi düzenlemeleri — web src/lib/payments/actions.ts ──────────
   unpayRow, setRowStatus, resetRowOverrides, saveRowEdit (bu ay / bu ve
   sonraki aylar), savePlanSettings, setTracking. Saf: yazılacak ay kayıtlarını
   ve planı döndürür; AppModel yazar.
   • Varsayılanlar ileriye dönük değişince geçmiş aylar eski değerleriyle
     sabitlenir (freezeBefore) — geçmiş yeniden yazılmaz.
─────────────────────────────────────────────────────────────────────────── */

public enum PaymentEdits {
    public enum Scope: String, Sendable { case month, forward }

    public struct RowValues: Equatable, Sendable {
        /// nil = varsayılan (plan tutarı; yoksa girilmemiş)
        public var amount: Double?
        public var fromAccountId: String?
        public var dueDate: String
        public var note: String?
        public init(amount: Double?, fromAccountId: String?, dueDate: String, note: String?) {
            self.amount = amount; self.fromAccountId = fromAccountId; self.dueDate = dueDate; self.note = note
        }
    }

    public struct PlanValues: Equatable, Sendable {
        public var amount: Double?
        public var fromAccountId: String?
        public var dayOfMonth: Int
        public var startMonth: String
        public var isActive: Bool
        public var notes: String?
        public init(amount: Double?, fromAccountId: String?, dayOfMonth: Int, startMonth: String, isActive: Bool, notes: String?) {
            self.amount = amount; self.fromAccountId = fromAccountId; self.dayOfMonth = dayOfMonth
            self.startMonth = startMonth; self.isActive = isActive; self.notes = notes
        }
    }

    /// Yazılacaklar: ay kayıtları (tombstone dahil) ve plan
    public struct Writes: Sendable {
        public var occurrences: [PaymentOccurrence] = []
        public var plan: PaymentPlan?
        public init(occurrences: [PaymentOccurrence] = [], plan: PaymentPlan? = nil) {
            self.occurrences = occurrences
            self.plan = plan
        }
    }

    /// Patch: nil değer = sütunu temizle (web nullify). Kayıt yoksa oluşturulur.
    public static func patched(_ kind: PaymentTargetKind, _ targetId: String, _ month: String,
                               _ patch: [String: JSONValue], existing: [PaymentOccurrence],
                               workspaceId: String?, now: String) -> PaymentOccurrence {
        let id = PaymentSchedule.occurrenceIdFor(kind, targetId, month)
        var raw: JSONObject = existing.first { $0.id == id && $0.isLive }?.raw ?? [
            "id": .string(id), "targetKind": .string(kind.rawValue), "targetId": .string(targetId),
            "month": .string(month), "createdAt": .string(now), "workspaceId": JSONValue(workspaceId),
        ]
        for (k, v) in patch { raw[k] = v }
        raw["deleted_at"] = .null
        return PaymentOccurrence(raw: raw)
    }

    static func tombstone(_ kind: PaymentTargetKind, _ targetId: String, _ month: String,
                          existing: [PaymentOccurrence], now: String) -> PaymentOccurrence? {
        let id = PaymentSchedule.occurrenceIdFor(kind, targetId, month)
        guard var raw = existing.first(where: { $0.id == id && $0.isLive })?.raw else { return nil }
        raw["deleted_at"] = .string(now)
        return PaymentOccurrence(raw: raw)
    }

    /// "Ödendi" işaretini kaldır (bağlı işlem silinmesi ayrı)
    public static func unpay(_ row: PaymentRow, existing: [PaymentOccurrence], workspaceId: String?, now: String) -> PaymentOccurrence {
        patched(row.target.kind, row.target.id, row.month,
                ["status": .null, "paidAmount": .null, "paidDate": .null, "transactionId": .null],
                existing: existing, workspaceId: workspaceId, now: now)
    }

    /// Bu ayı atla (`skipped`) ya da geri al (nil)
    public static func setStatus(_ row: PaymentRow, skipped: Bool, existing: [PaymentOccurrence],
                                 workspaceId: String?, now: String) -> PaymentOccurrence {
        patched(row.target.kind, row.target.id, row.month, ["status": skipped ? "skipped" : .null],
                existing: existing, workspaceId: workspaceId, now: now)
    }

    /// Ayın tutar/tarih/hesap özelleştirmelerini kaldır; durum ya da not yoksa kayıt silinir.
    public static func resetOverrides(_ row: PaymentRow, existing: [PaymentOccurrence], workspaceId: String?,
                                      now: String) -> PaymentOccurrence? {
        guard let occ = row.occurrence else { return nil }
        if occ.status == nil && (occ.note ?? "").isEmpty {
            return tombstone(row.target.kind, row.target.id, row.month, existing: existing, now: now)
        }
        return patched(row.target.kind, row.target.id, row.month,
                       ["amount": .null, "dueDate": .null, "fromAccountId": .null],
                       existing: existing, workspaceId: workspaceId, now: now)
    }

    struct Changes { var amount: Bool; var day: Bool; var from: Bool }

    /// `beforeMonth`tan önceki takip aylarını şimdiki çözülmüş değerleriyle sabitle.
    static func freezeBefore(_ target: PaymentTarget, _ beforeMonth: String, _ changes: Changes,
                             occurrences: [PaymentOccurrence], transactions: [Transaction], accounts: [Account],
                             fx: FX, workspaceId: String?, now: String, today: String) -> [PaymentOccurrence] {
        guard changes.amount || changes.day || changes.from, beforeMonth > target.startMonth else { return [] }
        let rows = PaymentSchedule.buildSchedule(
            targets: [target], occurrences: occurrences, transactions: transactions,
            from: target.startMonth, to: PaymentSchedule.shiftMonth(beforeMonth, -1), today: today,
            cardPayments: CardPayments.assignCardPayments(accounts: accounts, transactions: transactions), fx: fx)
        var out: [PaymentOccurrence] = []
        for r in rows {
            if r.outOfRange || r.occurrence?.status == "paid" { continue }
            var patch: [String: JSONValue] = [:]
            if changes.amount && !r.custom.amount, let a = r.amount { patch["amount"] = .number(a) }
            if changes.day && !r.custom.dueDate { patch["dueDate"] = .string(r.dueDate) }
            if changes.from && !r.custom.fromAccount, let f = r.fromAccountId { patch["fromAccountId"] = .string(f) }
            if !patch.isEmpty {
                out.append(patched(target.kind, target.id, r.month, patch, existing: occurrences, workspaceId: workspaceId, now: now))
            }
        }
        return out
    }

    /// Planı yamala (yoksa oluştur; web savePlan)
    public static func plan(_ target: PaymentTarget, _ patch: [String: JSONValue], plans: [PaymentPlan],
                            workspaceId: String?, now: String) -> PaymentPlan {
        let id = PaymentSchedule.planIdFor(target.kind, target.id)
        var raw: JSONObject = plans.first { $0.id == id }?.raw ?? [
            "id": .string(id), "targetKind": .string(target.kind.rawValue), "targetId": .string(target.id),
            "isActive": .bool(true), "createdAt": .string(now), "workspaceId": JSONValue(workspaceId),
        ]
        for (k, v) in patch { raw[k] = v }
        raw["deleted_at"] = .null
        return PaymentPlan(raw: raw)
    }

    /// Satır düzenleme (web saveRowEdit).
    public static func saveRowEdit(_ row: PaymentRow, values: RowValues, scope: Scope,
                                   occurrences: [PaymentOccurrence], plans: [PaymentPlan], transactions: [Transaction],
                                   accounts: [Account], fx: FX, workspaceId: String?, now: String,
                                   today: String = DateUtil.today()) -> Writes {
        let target = row.target
        let defaultDue = PaymentSchedule.dueDateFor(row.month, target.dayOfMonth ?? Int(row.dueDate.suffix(2)) ?? 1)
        let note: JSONValue = values.note.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : .string($0) } ?? .null
        var w = Writes()
        if scope == .month {
            let patch: [String: JSONValue] = [
                "amount": JSONValue(values.amount),
                "dueDate": values.dueDate == defaultDue ? .null : .string(values.dueDate),
                "fromAccountId": values.fromAccountId == target.defaultFromAccountId ? .null : JSONValue(values.fromAccountId),
                "note": note,
            ]
            let empty = values.amount == nil && values.dueDate == defaultDue
                && values.fromAccountId == target.defaultFromAccountId && note == .null
            if empty && row.occurrence?.status == nil {
                if let t = tombstone(target.kind, target.id, row.month, existing: occurrences, now: now) { w.occurrences = [t] }
                return w
            }
            w.occurrences = [patched(target.kind, target.id, row.month, patch, existing: occurrences, workspaceId: workspaceId, now: now)]
            return w
        }
        let day = values.dueDate == defaultDue ? target.dayOfMonth : Int(values.dueDate.suffix(2))
        let changes = Changes(amount: values.amount != target.defaultAmount, day: day != target.dayOfMonth,
                              from: values.fromAccountId != target.defaultFromAccountId)
        w.occurrences = freezeBefore(target, row.month, changes, occurrences: occurrences, transactions: transactions,
                                     accounts: accounts, fx: fx, workspaceId: workspaceId, now: now, today: today)
        w.plan = plan(target, ["amount": JSONValue(values.amount), "fromAccountId": JSONValue(values.fromAccountId),
                               "dayOfMonth": day.map { .number(Double($0)) } ?? .null, "updatedAt": .string(now)],
                      plans: plans, workspaceId: workspaceId, now: now)
        if let occ = row.occurrence {
            let patch: [String: JSONValue] = occ.status == "paid"
                ? ["note": note]
                : ["amount": .null, "dueDate": .null, "fromAccountId": .null, "note": note]
            w.occurrences.append(patched(target.kind, target.id, row.month, patch, existing: occurrences, workspaceId: workspaceId, now: now))
        } else if note != .null {
            w.occurrences.append(patched(target.kind, target.id, row.month, ["note": note], existing: occurrences,
                                         workspaceId: workspaceId, now: now))
        }
        return w
    }

    /// Hedefin varsayılanları (web savePlanSettings): bu aydan önceki aylar korunur.
    public static func savePlanSettings(_ target: PaymentTarget, values: PlanValues, occurrences: [PaymentOccurrence],
                                        plans: [PaymentPlan], transactions: [Transaction], accounts: [Account], fx: FX,
                                        workspaceId: String?, now: String, today: String = DateUtil.today()) -> Writes {
        var w = Writes()
        w.occurrences = freezeBefore(target, PaymentSchedule.monthOf(today),
                                     Changes(amount: values.amount != target.defaultAmount,
                                             day: values.dayOfMonth != target.dayOfMonth,
                                             from: values.fromAccountId != target.defaultFromAccountId),
                                     occurrences: occurrences, transactions: transactions, accounts: accounts, fx: fx,
                                     workspaceId: workspaceId, now: now, today: today)
        let notes = values.notes?.trimmingCharacters(in: .whitespacesAndNewlines)
        w.plan = plan(target, [
            "amount": JSONValue(values.amount), "fromAccountId": JSONValue(values.fromAccountId),
            "dayOfMonth": .number(Double(values.dayOfMonth)), "startMonth": .string(values.startMonth),
            "isActive": .bool(values.isActive), "notes": notes?.isEmpty == false ? .string(notes!) : .null,
            "updatedAt": .string(now),
        ], plans: plans, workspaceId: workspaceId, now: now)
        return w
    }

    /// Takibi aç / kapat (web setTracking)
    public static func setTracking(_ target: PaymentTarget, _ on: Bool, plans: [PaymentPlan], workspaceId: String?,
                                   now: String) -> PaymentPlan {
        plan(target, ["isActive": .bool(on), "updatedAt": .string(now)], plans: plans, workspaceId: workspaceId, now: now)
    }
}
