# Missing Auth/Authz Analysis Results: FinTrack OS

## Executive Summary
- Endpoints analyzed: 7
- Vulnerable: 0
- Likely Vulnerable: 0
- Not Vulnerable: 7
- Needs Manual Review: 0

> No role/permission hierarchy exists — every authenticated user is an equal-privilege tenant, so there is no vertical-privilege-escalation target surface. Analysis centers on missing authentication and RLS coverage.

## Findings

### [NOT VULNERABLE] Market-data API routes (`/api/prices`, `/api/prices/history`, `/api/prices/tefas`, `/api/brand-logo`)
- **File**: `src/app/api/**/route.ts`
- **Protection**: The proxy (`src/proxy.ts`) runs `supabase.auth.getUser()` on every non-static request and returns JSON 401 for any unauthenticated `/api/*` request. These routes hold no user data and touch no DB — they only proxy public third-party market data — so even if reached they expose nothing user-specific. Dev-only `AUTH_BYPASS=1` is guarded by `NODE_ENV !== 'production'`.

### [NOT VULNERABLE] PostgREST CRUD on the 8 user tables
- **File**: `supabase_schema.sql`
- **Protection**: Policies granted only to the `authenticated` role; anonymous requests have no grant. Owner-only RLS (`user_id = auth.uid()`) with `FORCE RLS`. No unauthenticated path to user data.

### [NOT VULNERABLE] `restore_user_backup` RPC
- **File**: `supabase/migrations/0004_restore_user_backup_tombstone.sql`
- **Protection**: `grant execute ... to authenticated` only; self-scope assertion rejects any `target_user_id` that differs from `auth.uid()`. No missing-auth or missing-role gap (there is no admin role to check).

### [NOT VULNERABLE] `user_backups` table
- **File**: `supabase/migrations/0005_user_backups.sql`
- **Protection**: Grants + policies restricted to `authenticated`; owner-only RLS; no anon access.

## Notes
- Single server-side auth checkpoint (`src/proxy.ts`) plus database-enforced RLS is a sound layered model for this architecture. The proxy is fail-closed: unauthenticated page requests redirect to `/login`, API requests get 401.
- Recommend confirming the proxy `matcher` covers all `/api/*` and authenticated page paths (no route accidentally excluded). This is a configuration check, not a code defect.
