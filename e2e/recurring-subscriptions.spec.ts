import { test, expect, openApp, createAccount, importCsv, trDate } from './helpers'

/** Bugünden n ay önce, aynı gün (kısa ayda ay sonuna kırpılır). */
function monthsAgo(n: number): Date {
  const t = new Date()
  const last = new Date(t.getFullYear(), t.getMonth() - n + 1, 0).getDate()
  return new Date(t.getFullYear(), t.getMonth() - n, Math.min(t.getDate(), last))
}

test('geçmişten tekrarlayan önerisi ve abonelik zammı', async ({ page }, testInfo) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Ana Hesap')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Ana Hesap').first()).toBeVisible()

  await importCsv(page, testInfo, [
    'TARİH;AÇIKLAMA;TUTAR;ETİKETLER',
    `${trDate(monthsAgo(3))};EV KIRASI HAZIRAN;-15.000,00;`,
    `${trDate(monthsAgo(2))};EV KIRASI TEMMUZ;-15.000,00;`,
    `${trDate(monthsAgo(1))};EV KIRASI AGUSTOS;-15.000,00;`,
    `${trDate(monthsAgo(0))};EV KIRASI EYLUL;-15.000,00;`,
    `${trDate(monthsAgo(2))};NETFLIX.COM;-199,99;abonelik`,
    `${trDate(monthsAgo(1))};NETFLIX.COM;-199,99;abonelik`,
    `${trDate(monthsAgo(0))};NETFLIX.COM;-229,99;abonelik`,
    `${trDate(monthsAgo(0))};MIGROS;-850,00;`,
    `${trDate(monthsAgo(0))};MIGROS;-640,00;`,
  ].join('\n'), 9)

  await page.goto('/subscriptions')
  await expect(page.getByText(/aboneliğe zam geldi/)).toBeVisible()
  await expect(page.getByText('Zam +%15')).toBeVisible()

  await page.goto('/recurring')
  const row = page.locator('div.flex.items-center.gap-4', { hasText: 'EV KIRASI' }).first()
  await expect(row).toBeVisible()
  await expect(page.locator('body')).not.toContainText('MIGROS')
  await row.getByRole('button', { name: 'Tekrarlayana ekle' }).click()
  // Şablon ay adından arınmış adla aktif listede; öneri düştü
  await expect(page.locator('body')).toContainText(/AKT[İI]F — 1/i)
  await expect(page.locator('body')).not.toContainText('EV KIRASI EYLUL')

  // Kalan öneriyi gizle → yenileyince gelmez
  await page.getByRole('button', { name: 'Gizle', exact: true }).first().click()
  await page.reload()
  await page.waitForTimeout(1500)
  await expect(page.getByRole('button', { name: 'Gizle', exact: true })).toHaveCount(0)
})
