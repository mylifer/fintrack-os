import { test as base, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

/* Ortak yardımcılar. `test` fikstürü her testte konsol hatalarını ve hata
   sınırını ("Bir şeyler ters gitti") izler; test sonunda ikisi de boş olmalı. */

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', m => {
      if (m.type() !== 'error') return
      const t = m.text()
      // Beklenen gürültü: hidrasyon uyarısı, girişsiz kipte buluta ulaşamayan
      // eşitleme / fiyat istekleri (placeholder Supabase, CI'da dış ağ)
      if (/A tree hydrated|Failed to fetch|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|net::|supabase|\[sync|\[prices|status of 5\d\d|status of 4\d\d/i.test(t)) return
      errors.push(t.slice(0, 300))
    })
    page.on('pageerror', e => errors.push(`[pageerror] ${e.message.slice(0, 300)}`))
    await use(errors)
    await expect(page.getByText('Bir şeyler ters gitti')).toHaveCount(0)
    expect(errors, 'konsol hataları').toEqual([])
  }, { auto: true }],
})

export { expect }

export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Banka dökümü biçimi: 25.09.2026 */
export const trDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }

/** Uygulamayı açar ve ilk yükleme (Dexie + store'lar) bitene kadar bekler. */
export async function openApp(page: Page) {
  await page.goto('/dashboard')
  await expect(page.locator('header h1').first()).toBeVisible()
  await page.waitForTimeout(1500)
}

export async function createAccount(page: Page, name: string, opts: { type?: string; opening?: string } = {}) {
  await page.goto('/accounts')
  await page.getByRole('button', { name: /Yeni Hesap/ }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('[id="hesap-adı"]').fill(name)
  if (opts.type) {
    await dlg.getByRole('combobox').first().click()
    await page.getByRole('option', { name: opts.type }).click()
  }
  if (opts.opening) await dlg.locator('[id="açılış-bakiyesi"]').fill(opts.opening)
  return dlg
}

/** CSV'yi yazar ve Ayarlar → İçe aktar'dan önizleyerek içe aktarır. */
export async function importCsv(page: Page, testInfo: { outputPath: (n: string) => string }, csv: string, rows: number) {
  const file = testInfo.outputPath('import.csv')
  writeFileSync(file, csv, 'utf8')
  await page.goto('/settings')
  await page.getByRole('button', { name: /Dosya Yükle/ }).click()
  await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles(file)
  await page.getByRole('button', { name: /Önizle/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`${rows} İşlemi İçe Aktar`) }).click()
  await expect(page.getByText(new RegExp(`${rows} işlem`)).first()).toBeVisible()
}
