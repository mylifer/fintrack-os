# Business Logic Analysis Results: FinTrack OS

## Executive Summary
- Scenarios analyzed: 5
- Exploitable: 0
- Likely Exploitable: 0
- Not Exploitable: 4
- Needs Manual Review: 1

> Critical framing: this is an **offline-first single-user personal ledger**. There is no payment processor, no shared/limited resource, no multi-party transaction, no coupon/inventory/subscription system, and no server-side business logic to bypass. All computation (balances, forecasts, statistics) runs client-side over the *user's own* data and syncs to a per-user RLS-isolated store. Manipulating any value only misleads or corrupts the acting user's own records — there is no cross-user or monetary impact. This eliminates most classic business-logic vulnerability classes by construction.

## Findings

### [NEEDS MANUAL REVIEW] Backup restore is a destructive wipe-and-replace
- **Category**: Workflow / data-integrity
- **File**: `src/components/backup/BackupManager.tsx` (`writeDexie`, lines ~326-345) and `restore_user_backup` RPC
- **Business rule**: A restore replaces ALL of the user's tables and clears the `_outbox` in the same transaction (authoritative replace). This is intended, atomic, and self-scoped (RLS + `target_user_id = auth.uid()`).
- **Uncertainty**: Not a security vulnerability (a user can only overwrite their own data). Flagged only as a data-loss UX concern: a mistaken import silently discards pending un-synced mutations. Confirm the UI shows a clear confirmation + preview before overwrite (a preview step exists via `validateBackup`).
- **Suggestion**: Ensure `validateBackup` rejects malformed/oversized payloads and that the confirmation dialog is unambiguous. No code defect identified.

### [NOT EXPLOITABLE] Negative / out-of-range transaction amounts
- **Category**: Quantity & numeric limits
- **Protection**: Amounts feed only the user's own computed balances. A negative or absurd amount corrupts only the acting user's ledger view; there is no server-side balance that transfers value to another party. Zod validation (`zod` v4) is applied at input boundaries.

### [NOT EXPLOITABLE] Account-to-account transfers
- **Category**: Transfer & balance logic
- **Protection**: Transfers move value between the user's *own* accounts (`accountId` → `toAccountId`); the net effect on the user's total net worth is zero and there is no recipient outside the user. No negative-transfer exploit reaches another party.

### [NOT EXPLOITABLE] Refund handling
- **Category**: Refund abuse
- **Protection**: `refundOfId` + `systemKind` columns (S4/S7 remediation) provide a first-class cumulative-refund guard rather than brittle tag matching. Refunds only offset the user's own original transaction.

### [NOT EXPLOITABLE] Concurrency / race conditions
- **Category**: Race conditions
- **Protection**: Writes go through a durable `_outbox` and are single-user; there is no contended shared resource (no shared inventory, balance, or coupon). The restore RPC is atomic. No TOCTOU window with cross-user consequence.
