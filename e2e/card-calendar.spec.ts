import { test, expect, openApp, createAccount } from './helpers'
import { cardCycle } from '../src/lib/payments/card-cycles'

const pad = (n: number) => String(n).padStart(2, '0')
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

test('Kart Takvimi: kesim girilince son ödeme kendiliğinden, aya özel tarih ve varsayılana dönüş', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Test Kartı', { type: 'Kredi Kartı' })
  await dlg.locator('[id="kredi-limiti"]').fill('50000')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  await page.goto('/kart-takvimi')
  const row = page.locator('tr', { hasText: 'Test Kartı' })
  await expect(row).toBeVisible()

  // Kesim 24 → son ödeme günü kendiliğinden 4 (kesim + 10 gün)
  const kesimGunu = row.getByLabel('Kesim günü', { exact: true })
  await kesimGunu.fill('24')
  await kesimGunu.blur()
  await expect(row.getByLabel('Son ödeme günü', { exact: true })).toHaveValue('4')
  await expect(row.getByLabel('Fark (gün)', { exact: true })).toHaveValue('10')

  // Bu ayın sütunu: kural kesim + 10, hafta sonu/tatilde ilk iş günü
  const now = new Date()
  const m = monthKey(now)
  const want = cardCycle({ statementDay: 24, dueDay: null, gapDays: 10, holidayRule: 'due' }, m)
  const idx = await page.locator('thead th').evaluateAll((ths, t) => ths.findIndex(th => th.textContent?.includes(t)), 'bu ay')
  expect(idx).toBeGreaterThan(0)
  const cell = row.locator('td').nth(idx)
  const kesim = cell.getByLabel('Kesim', { exact: true })
  const sonOdeme = cell.getByLabel('Son ödeme', { exact: true })
  await expect(kesim).toHaveValue(want.closing)
  await expect(sonOdeme).toHaveValue(want.dueDate!)

  // Banka bu ay kesimi bir gün öne aldı → yalnız o ay, mavi, ↺ ile geri
  const [y, mo, d] = want.closing.split('-').map(Number)
  const earlier = new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10)
  await kesim.fill(earlier)
  await expect(kesim).toHaveValue(earlier)
  await expect(kesim).toHaveClass(/border-primary/)
  await cell.getByRole('button', { name: 'Kesim: varsayılana döndür' }).click()
  await expect(kesim).toHaveValue(want.closing)
  await expect(cell.getByRole('button', { name: 'Kesim: varsayılana döndür' })).toHaveCount(0)
})

test('Kart Takvimi: olağan dışı kesim/son ödeme çifti uyarılır ve tek tıkla düzeltilir', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Garanti Deneme', { type: 'Kredi Kartı' })
  await dlg.locator('[id="kredi-limiti"]').fill('50000')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  await page.goto('/kart-takvimi')
  const row = page.locator('tr', { hasText: 'Garanti Deneme' })
  await row.getByLabel('Kesim günü', { exact: true }).fill('11')
  await row.getByLabel('Kesim günü', { exact: true }).blur()
  // Elle 16 girilir: kesimden 5 gün — yasal 10 günün altı
  await row.getByLabel('Son ödeme günü', { exact: true }).fill('16')
  await row.getByLabel('Son ödeme günü', { exact: true }).blur()
  await expect(row.getByText(/kesimden 5 gün sonra görünüyor/)).toBeVisible()
  await expect(row.getByText(/Garanti BBVA kuralı/)).toBeVisible()

  await row.getByRole('button', { name: 'Kesim 6 olsun' }).click()
  await expect(row.getByLabel('Kesim günü', { exact: true })).toHaveValue('6')
  await expect(row.getByLabel('Son ödeme günü', { exact: true })).toHaveValue('16')
  await expect(row.getByText(/görünüyor — yasal/)).toHaveCount(0)
})
