# IDOR Analysis Results: FinTrack OS

## Executive Summary
- Candidates analyzed: 3 (PostgREST CRUD on 8 user tables; `restore_user_backup` RPC; `user_backups` table)
- Vulnerable: 0
- Likely Vulnerable: 0
- Not Vulnerable: 3
- Needs Manual Review: 0

> Authorization in this app is **not** enforced in application code. There are no server handlers that fetch objects by user-supplied ID. Isolation is enforced entirely by Postgres Row-Level Security at the Supabase boundary, so IDOR review targets the RLS policies and the restore RPC.

## Findings

### [NOT VULNERABLE] PostgREST CRUD on the 8 user-owned tables
- **File**: `supabase_schema.sql` (DO block, lines ~28-105)
- **Endpoint**: `supabase.from(<table>).select/insert/update/delete` for accounts, transactions, categories, budgets, debts, investment_transactions, people, recurring_transactions
- **Protection**: `ENABLE` + `FORCE ROW LEVEL SECURITY` on every table. All pre-existing/legacy policies are dropped first (prevents an "allow all" policy OR-combining), then strict owner-only policies are installed for SELECT/INSERT/UPDATE/DELETE, all keyed on `user_id = auth.uid()`. UPDATE has both `USING` and `WITH CHECK` so a row cannot be re-assigned to another user. An attacker changing a row `id` in a PostgREST request cannot read or mutate another user's row because the policy filter is applied server-side regardless of the requested id.

### [NOT VULNERABLE] Backup restore RPC
- **File**: `supabase/migrations/0004_restore_user_backup_tombstone.sql`
- **Endpoint**: `supabase.rpc('restore_user_backup', { payload, target_user_id })`
- **Protection**: Runs `security invoker` (RLS still applies to the caller). Explicit self-scope assertion at the top: `if uid is null or target_user_id is null or target_user_id <> uid then raise exception 'unauthorized...'`. A caller cannot pass another user's id — the function rejects it before touching any data, and even if bypassed, RLS would still constrain writes to the caller's own rows.

### [NOT VULNERABLE] user_backups table (full-account snapshots)
- **File**: `supabase/migrations/0005_user_backups.sql`
- **Endpoint**: `supabase.from('user_backups').select/insert/delete`
- **Protection**: Owner-only RLS (`user_id = auth.uid()`), `ENABLE` + `FORCE RLS`, grants only to `authenticated` (no anon). No UPDATE policy (snapshots are immutable). One user cannot list, read, or delete another user's backups.

## Notes
- Client-side queries also add `.eq('user_id', ...)` / `.is('deleted_at', null)` filters, but these are defense-in-depth only — RLS is the actual trust boundary and holds even if the client filter is removed or tampered with.
