# FinTrack OS — SAST Final Report

**Scan date:** 2026-07-17
**Scope:** Full static assessment of the FinTrack OS codebase (`/Users/kaan/Desktop/fintrack-os`).
**Method:** Architecture recon (`sast/architecture.md`) followed by 14 vulnerability detectors. Authorization for this app lives in the database (Postgres RLS), so access-control review targeted RLS policies and the restore RPC rather than application handlers.

---

## Overall Verdict

**No exploitable vulnerabilities were found.** The application is well-hardened for its architecture: a single fail-closed server-side auth checkpoint (`src/proxy.ts`), database-enforced owner-only Row-Level Security with `FORCE RLS` on every user table, no raw SQL, no server-side code-execution or filesystem sinks, and no secrets shipped to the client. Several items are noted as **hardening suggestions / manual confirmations**, none of which is a live defect.

---

## Findings by Severity

### Critical / High
_None._

### Medium
_None._

### Low / Hardening (informational)

| # | Area | Item | File |
|---|------|------|------|
| 1 | SSRF (defense-in-depth) | Wikidata entity id interpolated into a fixed-host URL without encoding. Not user-controlled (comes from upstream search response), host/scheme are literals — no user-driven SSRF. Optionally validate `^Q[0-9]+$` or `encodeURIComponent`. | `src/app/api/brand-logo/route.ts` (~63-72) |
| 2 | Data integrity | Backup restore is a destructive atomic wipe-and-replace that also clears the `_outbox`. Self-scoped and safe (user can only overwrite their own data), but a mistaken import discards pending un-synced mutations — ensure the confirmation/preview step is unambiguous and `validateBackup` rejects malformed/oversized payloads. | `src/components/backup/BackupManager.tsx` |
| 3 | Config hygiene | Confirm `.env*` files are gitignored and that any `service_role` key lives only in server-side env (Vercel), never in `NEXT_PUBLIC_*`. Confirm the proxy `matcher` covers all `/api/*` and authenticated pages. | `src/lib/supabase.ts`, `src/proxy.ts` |

---

## Detector Results Summary

| Detector | Result | Notes |
|---|---|---|
| IDOR | ✅ Not vulnerable | RLS `user_id = auth.uid()` + `FORCE RLS`; restore RPC self-scoped |
| Missing Auth / Broken Access Control | ✅ Not vulnerable | Proxy 401/redirect + RLS; no role hierarchy to escalate |
| Business Logic | ✅ Not exploitable | Single-user offline ledger; no cross-user/monetary impact (1 data-integrity note) |
| SSRF | ✅ Not vulnerable | All outbound hosts are hardcoded literals (1 low-priority note) |
| Hardcoded Secrets | ✅ Not vulnerable | Only public anon key/URL from env; no leaked secrets |
| XSS | ✅ Not vulnerable | React auto-escaping; both `dangerouslySetInnerHTML` sinks are non-user data |
| SQL Injection | ✅ Not applicable | PostgREST only; no raw SQL; RPC uses bound params |
| Path Traversal | ✅ Not applicable | No server filesystem sinks |
| RCE | ✅ Not applicable | No eval/child_process/unsafe deserialization |
| JWT | ✅ Not applicable | Supabase Auth manages all token handling; no custom JWT code |
| File Upload | ✅ Not vulnerable | Only client-side JSON backup import; no server upload |
| GraphQL Injection | ✅ Not applicable | No GraphQL in the stack |
| XXE | ✅ Not applicable | All feeds parsed as JSON; no XML parsing |
| SSTI | ✅ Not applicable | No server-side template engine |

---

## Architecture Context (why the surface is small)

FinTrack OS is an **offline-first PWA**: business logic runs client-side, data persists in IndexedDB (Dexie) and syncs to Supabase Postgres via PostgREST. There is **no custom application server** doing SQL, auth, or business rules — the server surface is limited to the Next.js proxy and 4 read-only market-data API routes with hardcoded upstream hosts. The real trust boundary is **browser → Supabase**, where RLS is the enforcement layer. This design removes most traditional web-app attack classes by construction and concentrates the security-critical logic in the RLS policies (which were reviewed and found strict).

---

## Recommendations (priority order)

1. **Verify config hygiene** (item 3): `.env*` gitignored, `service_role` server-only, proxy `matcher` complete. Quick, high-value.
2. **Harden the backup import** (item 2): strict `validateBackup` schema + size cap + clear overwrite confirmation. Protects against accidental data loss.
3. **Optional SSRF tidy-up** (item 1): validate/encode the Wikidata id. Low priority, no live exploit.
4. **Consider promoting CSP from Report-Only to enforcing** once violations are reviewed (the app ships CSP in Report-Only mode per the architecture recon) — defense-in-depth against any future XSS regression.
5. **Keep Supabase client libraries current** so upstream auth/token fixes are inherited.

_Full per-detector detail is in the sibling `sast/*-results.md` files and `sast/architecture.md`._
