import { test, expect, openApp, createAccount, memFile, trDate, addDays } from './helpers'

/* Yüklenen Ekstreler → "Satırlar ve kararlar": onaylanan ekstre ilk yüklemedeki
   haliyle, her satıra verilen kararla ("Girme" dahil) açılır; bir karar
   değiştirilip kaydedilince yalnız o satır yazılır. */

const csv = (rows: [Date, string, string, string, string][]) =>
  ['Hesap No;TR00 0000', 'İşlem Tarihi;Açıklama;Borç;Alacak;Bakiye', ...rows.map(r => [trDate(r[0]), ...r.slice(1)].join(';'))].join('\n')

const pick = async (page: import('@playwright/test').Page, title: string, label: string) => {
  const sel = page.getByRole('combobox', { name: `${title} için karar` })
  const value = await sel.locator('option', { hasText: label }).first().getAttribute('value')
  await sel.selectOption(value!)
}

test('yüklenmiş ekstre kararlarıyla açılır, "Girme" dahil; değişen satır yazılır', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'E2E Karar')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  const d = addDays(new Date(), -3)
  await page.goto('/ekstre-yukle')
  await page.locator('input[type=file][accept*="application/pdf"]').setInputFiles(memFile('karar-banka.csv', csv([
    [d, 'BIRINCI DUKKAN', '100,00', '', '9.900,00'],
    [d, 'IKINCI DUKKAN', '200,00', '', '9.700,00'],
  ])))
  const mapper = page.getByTestId('column-mapper')
  await mapper.getByLabel('Ad (isteğe bağlı)').fill('Karar Bank')
  await mapper.getByRole('button', { name: 'Devam et · 2 işlem' }).click()
  await expect(page.getByRole('heading', { name: 'Karar Bank · hesap dökümü' })).toBeVisible()

  // Birinci: alıcısız gider (kategori seçilerek); ikinci: Girme
  await page.getByRole('button', { name: 'BIRINCI DUKKAN ayrıntısı', exact: true }).click()
  const row = page.getByRole('dialog')
  await row.getByRole('radio', { name: 'Gider olarak gir' }).check()
  await row.getByRole('combobox').filter({ hasText: 'Seçin' }).click()
  await page.getByPlaceholder('Kategori ara...').fill('Karar Gideri')
  await page.getByRole('button', { name: /“Karar Gideri” kategorisini ekle/ }).click()
  await row.getByRole('button', { name: 'Tamam' }).click()
  await pick(page, 'IKINCI DUKKAN', 'Girme')

  const offline = page.getByText(/Buluttaki en güncel kayıtlar alınamadı/)
  if (await offline.isVisible()) await offline.click()
  await page.getByRole('button', { name: /Onayla ve gir · 1 kayıt/ }).click()
  await expect(page.getByText('Ekstre işlendi')).toBeVisible()

  // Yüklenenler → Satırlar ve kararlar
  await page.goto('/ekstre-yukle/yuklenenler')
  await page.getByRole('link', { name: 'Satırlar ve kararlar' }).click()
  await expect(page.getByRole('heading', { name: 'Karar Bank · hesap dökümü' })).toBeVisible()
  await expect(page.getByText(/ilk yüklediğin haliyle, verdiğin kararlarla/)).toBeVisible()
  await expect(page.getByText('satıra “Girme” dedin')).toBeVisible()
  const first = page.getByRole('combobox', { name: 'BIRINCI DUKKAN için karar' })
  const second = page.getByRole('combobox', { name: 'IKINCI DUKKAN için karar' })
  await expect(first.locator('option:checked')).toHaveText(/Gider olarak gir/)
  await expect(second.locator('option:checked')).toHaveText(/Girme/)
  await expect(page.getByRole('button', { name: 'Değişiklik yok' })).toBeDisabled()
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/decisions.png`, fullPage: true })

  // İkinciyi "Girme"den çıkar → yalnız o satır yazılır
  await page.getByRole('button', { name: 'IKINCI DUKKAN ayrıntısı', exact: true }).click()
  const row2 = page.getByRole('dialog')
  await row2.getByRole('radio', { name: 'Gider olarak gir' }).check()
  await row2.getByRole('combobox').filter({ hasText: 'Seçin' }).click()
  await page.getByPlaceholder('Kategori ara...').fill('Karar Gideri')
  await page.getByRole('dialog').last().getByText('Karar Gideri', { exact: true }).click()
  await row2.getByRole('button', { name: 'Tamam' }).click()
  if (await offline.isVisible()) await offline.click()
  await page.getByRole('button', { name: 'Değişiklikleri kaydet · 1 satır' }).click()
  await expect(page.getByText('Ekstre işlendi')).toBeVisible()

  await page.goto('/ekstre-yukle/yuklenenler')
  await expect(page.getByText(/2 satır · 2 kayıt girildi/)).toBeVisible()
  // Yeniden açınca ikisi de "gir" kararıyla
  await page.getByRole('link', { name: 'Satırlar ve kararlar' }).click()
  await expect(page.getByRole('combobox', { name: 'IKINCI DUKKAN için karar' }).locator('option:checked')).toHaveText(/Gider olarak gir/)
  await expect(page.getByText('satıra “Girme” dedin')).toHaveCount(0)
})
