# SSRF Analysis Results: FinTrack OS

## Executive Summary

Scope: the 4 read-only market-data API routes (`/api/brand-logo`, `/api/prices`, `/api/prices/history`, `/api/prices/tefas`) and the server-only helper `src/lib/server/tefas-api.ts`. These are the only server-side outbound-request surface in the app (the rest of the data path is browser → Supabase). All outbound `fetch` sites were enumerated (`grep` confirmed 6 physical `fetch()` calls fanning out to 8 logical destinations) and each destination argument was traced back to its origin.

- Outbound call sites analyzed: 8 (logical destinations across 6 physical fetch calls)
- Vulnerable: 0
- Likely Vulnerable: 0
- Not Vulnerable: 7
- Needs Manual Review: 1

**Bottom line:** No SSRF was found. In every case the destination **host and scheme are hardcoded string literals**. User input reaches only (a) URL-encoded query-string values, (b) a POST JSON body field, or (c) URL path/subdomain segments that are strictly validated (fund code `^[A-Z0-9]{2,6}$` or ISO date `^\d{4}-\d{2}-\d{2}$`) — none of which lets an attacker change the host the server connects to. One site (Wikidata entity fetch) interpolates an upstream-response value into a path with a fixed host; it is not user-controlled but is flagged for manual review out of caution.

---

## Findings

### [NEEDS MANUAL REVIEW] Wikidata entity fetch — upstream-derived ID in URL path

- **File**: `src/app/api/brand-logo/route.ts` (lines 63-72, inside `fromWikidata`)
- **Endpoint / function**: `GET /api/brand-logo` → `resolveDomain` → `fromWikidata`
- **Uncertainty**: The URL `https://www.wikidata.org/wiki/Special:EntityData/${e.id}.json` interpolates `e.id` **without encoding**. `e.id` is not user input — it comes from the parsed response of the prior hardcoded Wikidata search call (`action=wbsearchentities`), and only entities whose normalized label/match text *exactly* equals the user's normalized `name` are used. The host (`www.wikidata.org`) and scheme are fixed literals, so even a malformed `e.id` cannot redirect the request to a different host; at worst it could path-traverse within `www.wikidata.org`. Because the value originates from a third party rather than the user, this is a second-order/data-provenance concern, not a user-driven SSRF.
- **Suggestion**: Low priority. If hardening is desired, validate `e.id` against Wikidata's Q-ID shape (`^Q[0-9]+$`) before interpolation, or `encodeURIComponent(e.id)`. No user-facing exploitation path exists today.

### [NOT VULNERABLE] Clearbit autocomplete lookup

- **File**: `src/app/api/brand-logo/route.ts` (lines 37-49, `fromClearbit` → `fetchJson` line 20)
- **Endpoint / function**: `GET /api/brand-logo` (query param `name`)
- **Reason**: Host and path are the hardcoded literal `https://autocomplete.clearbit.com/v1/companies/suggest`. The user-controlled `name` is length-bounded (2–64 chars, lines 91-93) and inserted only as `?query=${encodeURIComponent(name)}` — a URL-encoded query-string value that cannot alter the host, scheme, or path. Destination is not user-controllable.

### [NOT VULNERABLE] Wikidata entity search

- **File**: `src/app/api/brand-logo/route.ts` (lines 54-62, `fromWikidata` → `fetchJson` line 20)
- **Endpoint / function**: `GET /api/brand-logo` (query param `name`)
- **Reason**: Host/path hardcoded (`https://www.wikidata.org/w/api.php`). `name` is inserted only via `encodeURIComponent(name)` into the `search=` query param; `language=${lang}` iterates a fixed array `['tr','en']`. No user control over the destination host or scheme.

### [NOT VULNERABLE] FX rate fetch (live) — jsDelivr / Cloudflare Pages

- **File**: `src/app/api/prices/route.ts` (lines 15-40, `fetchUsdRates` → fetch line 29)
- **Endpoint / function**: `GET /api/prices` (takes no request parameters)
- **Reason**: `GET()` reads no request input at all. The `dateTag` used to build the URL is produced internally (`'latest'` or `isoDate(0/1)` — server-generated ISO dates). URLs are otherwise hardcoded (`cdn.jsdelivr.net`, `*.currency-api.pages.dev`). No user input reaches this call.

### [NOT VULNERABLE] Gold spot fetch — Yahoo Finance

- **File**: `src/app/api/prices/route.ts` (lines 61-79, `fetchGoldUsd` → fetch line 64)
- **Endpoint / function**: `GET /api/prices`
- **Reason**: URL is a fully hardcoded literal (`https://query1.finance.yahoo.com/v8/finance/chart/GC=F?...`). No dynamic component, no user input.

### [NOT VULNERABLE] Turkish gold quotes — Truncgil

- **File**: `src/app/api/prices/route.ts` (lines 95-127, `fetchTurkishGold` → fetch line 98)
- **Endpoint / function**: `GET /api/prices`
- **Reason**: URL is a fully hardcoded literal (`https://finans.truncgil.com/v4/today.json`). No dynamic component, no user input.

### [NOT VULNERABLE] Historical FX fetch — jsDelivr / Cloudflare Pages

- **File**: `src/app/api/prices/history/route.ts` (lines 32-56, `usdUrls` → `fetchUsd` fetch line 48)
- **Endpoint / function**: `GET /api/prices/history` (query params `asset`, `from`, `code`)
- **Reason**: The only dynamic URL component is `tag`, which is either the literal `'latest'` or a `date` value drawn from `sampleDates(from)`. `from` is strictly validated up front with `/^\d{4}-\d{2}-\d{2}$/` (line 110) and `sampleDates` regenerates dates via `Date`/`toISOString` (always canonical `YYYY-MM-DD`). Interpolating such a value into `.../currency-api@${tag}/...` or `https://${tag}.currency-api.pages.dev/...` cannot inject a new host or scheme — a plain date string contains no `.`, `/`, `@`, or `//` that could break out to another authority. Host suffixes are hardcoded. Not user-controllable.

### [NOT VULNERABLE] TEFAS fund-price fetch (POST)

- **File**: `src/lib/server/tefas-api.ts` (lines 32-57, fetch line 37); callers `src/app/api/prices/tefas/route.ts` (lines 40-48) and `src/app/api/prices/history/route.ts` (lines 94-98)
- **Endpoint / function**: `GET /api/prices/tefas` (query param `codes`) and `GET /api/prices/history?asset=TEFAS` (query param `code`)
- **Reason**: The request URL is the hardcoded literal `TEFAS_PRICE_URL = 'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir'`. User input (`code`) travels only inside the POST JSON body as `fonKodu: code` — it never touches the URL. Additionally, both callers validate each code against `^[A-Z0-9]{2,6}$` (tefas route line 44; history route line 115) and the tefas route caps at 30 codes. `period` is snapped to the fixed enum `{1,3,6,12,36,60}`. No user control over the destination.

---

## Notes

- **Consistent secure pattern:** every route validates inputs with regex/length caps *before* use and confines them to query-string values, POST bodies, or validated path segments of **fixed-host** URLs. This matches the architecture doc's claim that "upstream hosts are hardcoded (destination not user-chosen)".
- **No blocklist/allowlist crutches were relied upon:** these routes are safe by construction (hardcoded hosts) rather than by IP/hostname filtering, so the usual blocklist-bypass caveats (DNS rebinding, alternate IP encodings, redirect chains) do not apply to the destination selection. Note that `fetch()` follows redirects by default, so a compromised upstream returning a 3xx could still redirect the server elsewhere — this is an upstream-trust consideration, not an input-driven SSRF, and is out of scope for this class.
- No SSRF-relevant outbound calls exist outside the reviewed files (the browser→Supabase path uses the Supabase client, not server-side `fetch`).
