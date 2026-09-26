import { defineConfig } from '@playwright/test'

/* Uçtan uca testler (e2e/). Uygulama AUTH_BYPASS=1 ile girişsiz açılır; veri her
   testin kendi tarayıcı bağlamındaki IndexedDB'de kalır, buluta yazılmaz.
   AUTH_BYPASS yalnız `next dev`'de geçerli (production'da yok sayılır) — bu
   yüzden testler geliştirme sunucusuna karşı çalışır.

   Yerelde açık bir `AUTH_BYPASS=1 npm run dev -- --port 3457` varsa o kullanılır.
   Tarayıcı indirmeden sistemdeki Edge ile: PW_CHANNEL=msedge npm run test:e2e */

const PORT = Number(process.env.E2E_PORT ?? 3457)
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // Tek geliştirme sunucusu, sayfa ilk açılışta derlenir — paralel çalışmak
  // derleme kuyruğunda zaman aşımı üretir.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    viewport: { width: 1400, height: 950 },
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      AUTH_BYPASS: '1',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://e2e-placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'e2e-placeholder-anon-key',
    },
  },
})
