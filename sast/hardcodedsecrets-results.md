# Hardcoded Secrets Analysis Results: FinTrack OS

## Executive Summary
- Candidates analyzed: 3
- Vulnerable: 0
- Likely Vulnerable: 0
- Not Vulnerable: 3
- Needs Manual Review: 0

## Findings

### [NOT VULNERABLE] Supabase URL + anon key in client
- **File**: `src/lib/supabase.ts` (lines 3-4), `src/proxy.ts` (lines 79-80)
- **Reason**: Read from `process.env.NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — no hardcoded values in source. The anon key is **designed to be public** and ship in the client bundle; it is safe precisely because Row-Level Security constrains what it can do. No `service_role` key appears anywhere in `src/`.

### [NOT VULNERABLE] No secret literals in client or server code
- **File**: (repo-wide grep of `src/`)
- **Reason**: No matches for `service_role`, `SUPABASE_SERVICE*`, `sk_live`/`sk_test`, private-key headers (`-----BEGIN`), AWS (`AKIA`), Google (`AIza`), Slack (`xoxb-`), or GitHub (`ghp_`) tokens. All credentials are sourced from environment variables.

### [NOT VULNERABLE] `AUTH_BYPASS` env flag
- **File**: `src/proxy.ts` (line 118)
- **Reason**: Not a secret. A dev convenience flag, hard-guarded by `NODE_ENV !== 'production'`, so it cannot weaken authentication in a production deploy.

## Notes
- Confirm that the actual `.env*` files holding the Supabase URL/anon key (and any server-side keys used at deploy time) are gitignored and never committed. The service_role key, if used, must live only in server-side env (Vercel project settings), never in `NEXT_PUBLIC_*`.
