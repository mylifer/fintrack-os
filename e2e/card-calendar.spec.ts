import { test, expect, openApp, createAccount } from './helpers'

const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

test('Kart Takvimi: varsayılan günler, aya özel tarih ve varsayılana dönüş', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Test Kartı', { type: 'Kredi Kartı' })
  await dlg.locator('[id="kredi-limiti"]').fill('50000')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  await page.goto('/kart-takvimi')
  const row = page.locator('tr', { hasText: 'Test Kartı' })
  await expect(row).toBeVisible()
  await expect(row.getByText('Son ödeme gününü girin')).toBeVisible()

  // Varsayılanlar: kesim 24, son ödeme 4
  await row.getByLabel('Kesim', { exact: true }).first().fill('24')
  await row.getByLabel('Kesim', { exact: true }).first().blur()
  await row.getByLabel('Son ödeme', { exact: true }).first().fill('4')
  await row.getByLabel('Son ödeme', { exact: true }).first().blur()
  await expect(row.getByText('Son ödeme gününü girin')).toHaveCount(0)

  // Bu ayın sütunu: son ödeme bu ayın 4'ü, kesim geçen ayın 24'ü
  const now = new Date()
  const m = monthKey(now)
  const prev = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const col = page.locator('thead th').filter({ hasText: 'bu ay' })
  const idx = await page.locator('thead th').evaluateAll((ths, t) => ths.findIndex(th => th.textContent?.includes(t)), 'bu ay')
  expect(idx).toBeGreaterThan(0)
  await expect(col).toBeVisible()
  const cell = row.locator('td').nth(idx)
  const kesim = cell.getByLabel('Kesim', { exact: true })
  const sonOdeme = cell.getByLabel('Son ödeme', { exact: true })
  await expect(kesim).toHaveValue(`${prev}-24`)
  await expect(sonOdeme).toHaveValue(`${m}-04`)

  // Banka bu ay kesimi bir gün öne aldı
  await kesim.fill(`${prev}-23`)
  await expect(kesim).toHaveValue(`${prev}-23`)
  await expect(kesim).toHaveClass(/border-primary/)
  await expect(cell.getByRole('button', { name: 'Kesim: varsayılana döndür' })).toBeVisible()

  // Varsayılana dön
  const cell2 = page.locator('tr', { hasText: 'Test Kartı' }).locator('td').nth(idx)
  await cell2.getByRole('button', { name: 'Kesim: varsayılana döndür' }).click()
  await expect(cell2.getByLabel('Kesim', { exact: true })).toHaveValue(`${prev}-24`)
  await expect(cell2.getByRole('button', { name: 'Kesim: varsayılana döndür' })).toHaveCount(0)
})
