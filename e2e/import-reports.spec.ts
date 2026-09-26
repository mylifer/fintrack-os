import { test, expect, openApp, createAccount, importCsv, trDate } from './helpers'

test('dökümden içe aktarma → aylık özet ve dönem kıyası', async ({ page }, testInfo) => {
  await openApp(page)
  const dlg = await createAccount(page, 'E2E Banka')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('E2E Banka').first()).toBeVisible()

  const today = new Date()
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastYear = new Date(today.getFullYear() - 1, today.getMonth(), 1)
  await importCsv(page, testInfo, [
    'TARİH;AÇIKLAMA;TUTAR',
    `${trDate(today)};MIGROS ATASEHIR;-1.000,00`,
    `${trDate(today)};MAAS ODEMESI;40.000,00`,
    `${trDate(today)};EV KIRASI;-15.000,00`,
    `${trDate(prevMonth)};MIGROS ATASEHIR;-500,00`,
    `${trDate(prevMonth)};MAAS ODEMESI;40.000,00`,
    `${trDate(lastYear)};MIGROS ATASEHIR;-800,00`,
  ].join('\n'), 6)

  // Raporlar: kıyas anahtarı
  await page.goto('/reports')
  await page.getByRole('button', { name: 'Geçen yıl', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Geçen yıl', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Aylık özet — ayın ilk haftasında varsayılan geçen aydır
  await page.getByRole('link', { name: 'Aylık Özet' }).click()
  await expect(page).toHaveURL(/\/reports\/monthly/)
  if (today.getDate() <= 7) await page.getByRole('button', { name: 'Sonraki ay' }).click()
  const main = page.locator('body')
  for (const s of ['₺40.000,00', '₺16.000,00', '₺24.000,00', '%60', 'EV KIRASI']) {
    await expect(main).toContainText(s)
  }
  await expect(page.getByRole('button', { name: 'Sonraki ay' })).toBeDisabled()

  await page.getByRole('button', { name: 'Önceki ay' }).click()
  await expect(main).toContainText('₺500,00')
})
