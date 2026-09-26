import { test, expect } from './helpers'

/* Her ana sayfa boş veriyle hatasız açılmalı: hata sınırı yok, konsolda
   beklenmeyen hata yok (bkz. helpers.ts fikstürü). */

const PAGES = [
  '/dashboard', '/transactions', '/accounts', '/categories', '/tags',
  '/investments', '/reports', '/reports/monthly', '/statistics', '/forecast',
  '/budgets', '/goals', '/debts', '/payments', '/recurring', '/subscriptions',
  '/aile-uyeleri', '/alicilar', '/settings',
]

for (const path of PAGES) {
  test(`${path} açılır`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('header h1').first()).toBeVisible()
    await page.waitForTimeout(800)
  })
}
