import { test, expect, openApp, addDays, iso } from './helpers'
import type { Page } from '@playwright/test'

/* Dış fiyat servislerine bağlı kalmadan: birim fiyat elle girilir. Geriye
   tarihli satışın kârı satış ANINDAKİ ortalama maliyetle hesaplanmalı (#7). */

async function trade(page: Page, kind: 'Al' | 'Sat', qty: string, price: string, date: string) {
  await page.getByRole('button', { name: kind, exact: true }).first().click()
  const m = page.locator('div.fixed.inset-0.z-50').last()
  if (kind === 'Sat') await m.getByRole('button', { name: 'Sat', exact: true }).first().click()
  await m.locator('input[type=date]').fill(date)
  await m.locator('input[type=number]').first().fill(qty)
  // Geçmiş fiyat isteği (varsa) bitsin, sonra fiyatı elle yaz
  await expect(m.getByText('Fiyat yükleniyor...')).toHaveCount(0)
  await m.locator('input[type=number]').nth(1).fill(price)
  await m.getByRole('button', { name: kind, exact: true }).last().click()
  await expect(m).toHaveCount(0)
}

test('altın: geriye tarihli satışta gerçekleşen K/Z ve getiri paneli', async ({ page }) => {
  await openApp(page)
  await page.goto('/investments')
  const d = (n: number) => iso(addDays(new Date(), -n))
  await trade(page, 'Al', '10', '1000', d(90))
  await trade(page, 'Al', '10', '3000', d(30))
  // Sonradan girilen ama 60 gün önceye tarihli satış: maliyet 1000 (sonraki alım sayılmaz)
  await trade(page, 'Sat', '5', '1500', d(60))

  const panel = page.locator('div.rounded-xl', { has: page.getByText('Getiri', { exact: true }) }).last()
  await expect(panel).toContainText('+₺2.500,00')
})
