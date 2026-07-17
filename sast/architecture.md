# Architecture: FinTrack OS

Personal / family finance tracking PWA. It is an **offline-first, local-first single-page app**: all data lives in the browser (IndexedDB via Dexie) and is synced to a Supabase (Postgres) backend that acts as the cloud source of truth and the multi-tenant isolation boundary. There is effectively no custom application server tier beyond a handful of read-only Next.js API routes that proxy public market-data feeds; the security-critical data path is **browser → Supabase (PostgREST + Auth + RPC)**, protected by Row-Level Security.

## Technology Stack

| Category | Details |
|---|---|
| Languages | TypeScript (~5.x), SQL (PostgreSQL / Supabase); JS runtime is Node.js (>=20 types) for API routes and Edge/Node for the proxy |
| Frameworks | Next.js 16.2.9 (App Router, React Server Components), React 19.2.4, React-DOM 19.2.4. UI: Radix UI, shadcn, Tailwind CSS v4, Recharts, Lucide/Tabler/Iconify icons. State: Zustand 5. Validation: Zod 4 |
| Client persistence / "ORM" | Dexie 4 (IndexedDB wrapper) — local tables mirror Supabase tables; `@tanstack/react-virtual` for large lists |
| Databases | Supabase PostgreSQL (cloud source of truth); IndexedDB (per-device local store, DB name `fintrack-os`, schema v10). No server-side SQL query building in app code — all DB access via the Supabase JS client (PostgREST) |
| Auth mechanism | Supabase Auth (email + password). Session persisted in cookies via `@supabase/ssr` (`createBrowserClient` in the browser, `createServerClient` in the proxy). Authorization enforced server-side by Postgres **Row-Level Security** (owner-only, `user_id = auth.uid()`, `FORCE RLS`). No custom JWT signing/verification in app code — tokens are Supabase-issued |
| Testing / tooling | Vitest 4, Playwright 1.61, ESLint 9 |
| Infrastructure | Vercel (deploy target; `@vercel/speed-insights`). No Dockerfile / k8s / Terraform / CI config in repo. PWA: custom service worker (`/public/sw.js`), web manifest. Security headers in `next.config.ts`; per-request nonce CSP in `src/proxy.ts` |
| External services | Supabase (auth + DB + RPC); Clearbit autocomplete + Wikidata/Wikimedia (brand-logo resolution); fawazahmed0 currency-api via jsDelivr CDN & Cloudflare Pages (FX rates); Yahoo Finance `query1.finance.yahoo.com` (gold spot); Truncgil `finans.truncgil.com` (Turkish gold quotes); TEFAS `www.tefas.gov.tr` (mutual-fund prices); Google favicons + api.iconify.design (images/icons, client-side); Vercel vitals; Google Fonts (Geist, build-time) |

## Architecture Overview

**Shape:** A monolithic Next.js App-Router application, but architecturally a **thick client + thin backend**. Almost all business logic (balances, budgets, debts, investments P&L, recurring generation, reconciliation, FX conversion, forecasting) runs client-side in `src/lib/**` and Zustand stores. The backend is Supabase; the Next.js server only hosts:
- the **proxy** (`src/proxy.ts`, Next.js "proxy" == middleware equivalent in this version) that gates auth and sets security headers, and
- four **read-only market-data API routes** under `src/app/api/**` that fetch and reshape public third-party feeds (no user data, no DB access).

There are **no Next.js Server Actions** (`grep 'use server'` → none) and no server-side mutation endpoints for user data.

**Main modules:**
- `src/lib/db/index.ts` — Dexie schema (8 synced entity tables + `_outbox`), versioned migrations v1–v10.
- `src/lib/sync/engine.ts` — the heart of the system. Durable **outbox** pattern: every local mutation writes the entity table AND an `_outbox` entry in one IndexedDB transaction; a background flusher upserts snapshots to Supabase with retry/backoff/dead-lettering; a **reconciling pull** paginates the cloud set and merges non-destructively. Includes cross-tenant/shared-device guards (`ownerId` tagging, `guardUserSwitch`).
- `src/lib/supabase.ts` / `src/lib/auth.ts` — Supabase browser client, session helpers, local-data wipe on logout/user-switch.
- `src/lib/backup-sync.ts` + `supabase/migrations/0001_restore_user_backup.sql` — full-account backup/restore via a `security invoker` Postgres RPC that deletes-then-reinserts all of the caller's rows atomically.
- `src/lib/server/tefas-api.ts` — server-only TEFAS fetch helper (kept server-side because CSP `connect-src` forbids the browser from reaching it).
- `src/store/*.store.ts` — Zustand stores; each `load()` calls `reconcilingPull`, and mutations go through `localUpsert/localPatch/localBatch/softDelete`.
- `src/components/layout/DataProvider.tsx` — client bootstrap: user-switch guard → load parent tables → load child tables + prices → start auto-sync → maybe auto-backup.
- `src/app/(main)/**` — authenticated app pages (dashboard, transactions, accounts, budgets, categories, debts, investments, recurring, reports, statistics, subscriptions, tags, forecast, aile-uyeleri/family, alıcılar/recipients, settings).

## Data Flow

**Registration / Login (`src/app/register/page.tsx`, `src/app/login/page.tsx`):** Client calls `supabase.auth.signUp` / `signInWithPassword` directly against Supabase Auth. Errors are collapsed to generic messages to avoid account enumeration. Register enforces a client-side 12-char minimum (server policy is Supabase-side). On login, a shared-device check compares the previous uid (`ft_last_uid` in localStorage); if a different user logged in on this device, `clearLocalData()` wipes Dexie + all browser storage (keeps only theme) and forces a hard navigation to `/dashboard`. Session lands in cookies.

**Request gating (`src/proxy.ts`):** Runs on every non-static request. Generates a per-request nonce, builds a nonce-based CSP (currently shipped **Report-Only**), refreshes the Supabase session, and calls `supabase.auth.getUser()`. Unauthenticated requests to `/api/*` get a JSON 401; other unauthenticated requests redirect to `/login`. Authenticated users hitting `/login` or `/register` are redirected to `/dashboard`. A dev-only `AUTH_BYPASS=1` opt-in exists that is ignored in production.

**Core data mutation (create/edit/delete a transaction, account, budget, etc.):** UI → Zustand store action → `localUpsert/localPatch/localBatch/softDelete` (`sync/engine.ts`). Writes the Dexie entity table + `_outbox` entry in one IndexedDB transaction, tagged with the current session's `ownerId`. `kickSync()` debounces a flush: `flushOutbox()` re-stamps `user_id` from the live session and `supabase.from(table).upsert(payload, { onConflict: 'id' })`, deleting the outbox entry only on ACK. Deletes are **soft** (tombstone `deleted_at`).

**Data read / sync-down (`reconcilingPull`):** On load and refresh, paginate `supabase.from(table).select('*').eq('user_id', userId).range(...)` past the 1000-row cap. RLS is the real gate; the explicit `user_id` filter is defense-in-depth. Cloud rows upsert into Dexie except rows with a pending outbox entry; a local row missing from a *complete* cloud set is re-enqueued for push (never deleted-by-absence). Only live rows (`deleted_at == null`) are surfaced to the UI.

**Backup / restore (`BackupManager.tsx` → `cloudReplaceAll` → `restore_user_backup` RPC):** Export produces a JSON file (client `FileReader` + `JSON.parse`, validated reject-all before applying). Restore calls the `security invoker` RPC with the full payload and `target_user_id`; the RPC asserts `target_user_id = auth.uid()` and atomically deletes then re-inserts all of the caller's rows (`user_id` forced to caller). Automatic snapshots stored in `user_backups` (immutable; no UPDATE policy).

**Market data (API routes):** Client polls `/api/prices`, `/api/prices/history`, `/api/prices/tefas`, `/api/brand-logo`. Each route validates inputs (regex/length caps), fetches public third-party feeds server-side with timeouts and in-memory caches, and returns reshaped JSON. No user data or DB touched. Inputs are used as query params / JSON bodies to fixed upstream hosts (fund codes constrained to `^[A-Z0-9]{2,6}$`, brand name length-bounded).

## Entry Points

| Entry Point | Type | Auth Required | Description |
|---|---|---|---|
| `src/proxy.ts` (all non-static routes) | HTTP middleware/"proxy" | N/A (it enforces auth) | Session refresh, auth gate (redirect / 401), per-request nonce CSP + security headers |
| `GET /api/brand-logo?name=` | HTTP (Route Handler) | Yes (via proxy) | Resolves brand name → domain using Clearbit + Wikidata; server-side outbound fetch; name length-validated, 24h in-memory cache |
| `GET /api/prices` | HTTP (Route Handler) | Yes (via proxy) | FX (USD/EUR/GBP→TRY) + gold quotes from currency-api / Yahoo / Truncgil; no user input |
| `GET /api/prices/history?asset=&from=&code=` | HTTP (Route Handler) | Yes (via proxy) | Historical FX/gold/TEFAS series; validates `asset` enum, `from` date regex, `code` `^[A-Z0-9]{2,6}$` |
| `GET /api/prices/tefas?codes=` | HTTP (Route Handler) | Yes (via proxy) | TEFAS fund prices; codes validated `^[A-Z0-9]{2,6}$`, max 30 codes; server-side POST to tefas.gov.tr |
| `/login`, `/register` | Client pages (public) | No | Supabase email/password auth via browser client |
| `/` and `/(main)/*` app pages (dashboard, transactions, accounts, budgets, categories, debts, investments, recurring, reports, statistics, subscriptions, tags, forecast, aile-uyeleri, alicilar, settings, + dynamic `[id]`/`[key]`/`[tag]`) | Client pages / RSC | Yes (via proxy) | Authenticated SPA views; all data access via the Supabase browser client |
| Supabase PostgREST (`supabase.from(<table>)` select/upsert) | External API (browser→Supabase) | Yes (Supabase session; RLS) | Primary CRUD path for the 8 user tables + `user_backups`; the real trust boundary |
| Supabase Auth (`supabase.auth.*`) | External API (browser→Supabase) | Partial | signUp / signInWithPassword / getUser / getSession |
| Supabase RPC `restore_user_backup(payload, target_user_id)` | External RPC (browser→Supabase) | Yes (authenticated; self-only check) | Atomic full-account wipe+reinsert from a backup JSON |

## Trust Boundaries

- **Browser (untrusted) → Next.js proxy:** The proxy is the only server-side auth checkpoint for page/API access. All request headers/cookies are attacker-controllable; the CSP is currently **Report-Only** (not enforced).
- **Browser → Next.js API routes:** Query params / JSON reach server-side `fetch` to fixed third-party hosts. User input influences URLs/bodies (fund codes, brand names, dates) — validation lives in each route. Routes hold no user data.
- **Browser → Supabase (PostgREST / Auth / RPC):** The single most important boundary and the multi-tenant isolation point. The client sends the Supabase session; **Postgres RLS (`user_id = auth.uid()`, `FORCE RLS`) is the authoritative access control**. The client-side `.eq('user_id', ...)` filter and the outbox `ownerId` tagging are defense-in-depth, not the primary control. A misconfigured/disabled RLS policy would expose cross-tenant data.
- **Next.js API routes → third-party services (Clearbit, Wikidata, currency-api CDNs, Yahoo, Truncgil, TEFAS):** Server-to-untrusted-internet. Responses are parsed as JSON and reshaped; upstream hosts are hardcoded (destination not user-chosen), with request timeouts.
- **Per-device local store (IndexedDB) is tenant-scoped only by convention:** IndexedDB is bound to the browser origin, not the user session. Shared-device / account-switch handling (`guardUserSwitch`, login `clearLocalData`, outbox `ownerId` drop) is the boundary preventing one user's local residue from leaking into another account.
- **Restore RPC self-scope:** `restore_user_backup` runs `security invoker` and rejects `target_user_id <> auth.uid()`, bounding a destructive operation to the caller's own rows.

## Sensitive Data Inventory

| Data Type | Where Stored | How Accessed | Protection |
|---|---|---|---|
| User credentials (email, password) | Supabase Auth (`auth.users`) — never in app tables | `supabase.auth.signUp/signInWithPassword` | Managed by Supabase (hashing, password policy); generic error messages to avoid enumeration; client 12-char min |
| Session tokens | Browser cookies (via `@supabase/ssr`) + in-memory | Browser client & proxy `createServerClient` | HTTPS/HSTS, cookie flags set by Supabase SSR; wiped on logout/user-switch (`clearLocalData`) |
| Financial transactions (amounts, dates, merchants, notes, tags, base-currency `amountTry`) | Supabase `transactions`; mirrored in IndexedDB `transactions` | Supabase browser client / PostgREST; Dexie locally | RLS owner-only; local wipe on user-switch; part of backups |
| Account balances & credit-card details (limits, statement/due days, initial balance) | Supabase `accounts`; IndexedDB `accounts` | Supabase client; Dexie | RLS owner-only |
| Debts / loans (counterparty names, amounts, interest) | Supabase `debts`; IndexedDB | Supabase client; Dexie | RLS owner-only |
| Investment holdings (assets, quantities, prices, gold, FX, TEFAS funds) | Supabase `investment_transactions`; IndexedDB | Supabase client; Dexie | RLS owner-only |
| Budgets, categories, recurring transactions | Supabase `budgets`/`categories`/`recurring_transactions`; IndexedDB | Supabase client; Dexie | RLS owner-only |
| PII of related persons (family members, recipients — names, optional URLs) | Supabase `people`; IndexedDB; recipient names also sent to `/api/brand-logo` → Clearbit/Wikidata | Supabase client; Dexie; outbound to 3rd parties for logo lookup | RLS owner-only; brand-logo lookup exposes a recipient/merchant *name* to external services |
| Full-account backups / snapshots (all of the above as JSON) | Supabase `user_backups` (jsonb); exported `.json` files on the user's device | RPC/select; `FileReader`/download in `BackupManager` | RLS owner-only, immutable (no UPDATE policy); restore RPC self-scoped; exported files leave the app's control |
| Supabase project URL & anon key | `.env.local`, shipped to client as `NEXT_PUBLIC_*` | Public by design (anon key is meant to be public; RLS is the guard) | Anon key is safe to expose only if RLS is correct; no service-role key present in client code |
| Market-data cache (FX/gold/fund prices) | In-memory in API-route module scope | Server-side only | Non-sensitive, public data |

---

### Notes for later phases (not vulnerabilities — recon observations)
- This project's Next.js has intentional breaking changes: `src/proxy.ts` is the middleware equivalent, and the CSP is deliberately `Content-Security-Policy-Report-Only` (see comments in `proxy.ts`).
- The real authorization surface for IDOR / broken-access-control review is **Supabase RLS + the `restore_user_backup` RPC**, not app-layer checks — client-side `user_id` filters are defense-in-depth.
- SSRF surface is concentrated in the four `/api/**` routes and `src/lib/server/tefas-api.ts` (server-side outbound fetch), though destination hosts are hardcoded and inputs are regex/length-validated.
- No server-side rendering of user data into HTML sinks and no server actions; XSS review should focus on client React (`dangerouslySetInnerHTML` usage — the theme-restore script in `layout.tsx` is nonce-guarded and static).
