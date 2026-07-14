---
name: verify
description: Build, launch, and drive fintrack-os to verify a change end-to-end in the running app.
---

# Verifying fintrack-os changes

## Launch

```bash
AUTH_BYPASS=1 npm run dev -- --port 3457   # background; ready when /debts returns 200
```

- Auth is enforced by [src/proxy.ts](../../src/proxy.ts) (Supabase session → redirect to /login).
  `AUTH_BYPASS=1` skips it in non-production — no login needed.
- Data is local-first (Dexie/IndexedDB per browser profile). A fresh Playwright
  profile starts empty; seed state through the UI, not the DB.

## Drive (Playwright)

- `playwright` is a devDependency and Chromium is installed. From a script outside
  the repo, import via absolute path:
  `import { chromium } from '/…/fintrack-os/node_modules/playwright/index.mjs'`
- Form inputs get `id` from their Turkish label, lowercased with spaces→dashes:
  `#açıklama`, `#toplam-tutar`, `#ödenen`.
- The app-level error boundary renders **"Bir şeyler ters gitti"** — assert its
  absence, and collect `console`/`pageerror` events for React errors.
- Sync to Supabase fails harmlessly under AUTH_BYPASS (no user); local UI flows
  still work.
- BUT: on page load, stores pull from Supabase first (`reconcilingPull`) and the
  empty cloud result wins — rows injected directly into IndexedDB do NOT survive
  a reload under AUTH_BYPASS. Seed state through the UI in the same session
  instead of writing to Dexie and reloading.

## Gotchas

- There is a pre-existing hydration-mismatch console error on page load (theme
  script) — not a regression signal.
- Zustand stores: selecting a derived getter that builds new objects per call
  (e.g. `useShallow(s => s.getActive())`) infinite-loops React. Subscribe to raw
  state + `useMemo` instead.
