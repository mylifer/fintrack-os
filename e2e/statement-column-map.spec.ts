import { test, expect, openApp, createAccount, memFile, trDate, addDays } from './helpers'

/* Ekstre Yükle: biçimi tanınmayan döküm → sütun eşleme → mevcut önizleme ve
   kayıt hattı; aynı biçimin sonraki dökümünde eşleme hatırlanır. */

const csv = (rows: [Date, string, string, string, string][]) =>
  ['Hesap No;TR00 0000', 'İşlem Tarihi;Açıklama;Borç;Alacak;Bakiye', ...rows.map(r => [trDate(r[0]), ...r.slice(1)].join(';'))].join('\n')

test('tanınmayan döküm: sütun eşleme önerilir, önizlemeden kaydedilir, eşleme hatırlanır', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'E2E Vadesiz')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  const d = addDays(new Date(), -3)
  await page.goto('/ekstre-yukle')
  const input = page.locator('input[type=file][accept*="application/pdf"]')
  await input.setInputFiles(memFile('ornek-banka.csv', csv([
    [d, 'MIGROS ATASEHIR', '1.000,00', '', '9.000,00'],
    [addDays(d, 1), 'MAAS ODEMESI', '', '40.000,00', '49.000,00'],
    [addDays(d, 2), 'EV KIRASI', '15.000,00', '', '34.000,00'],
  ])))

  const mapper = page.getByTestId('column-mapper')
  await expect(mapper.getByRole('heading', { name: 'Sütunları eşleyin' })).toBeVisible()
  await expect(mapper.getByText('3 işlem okundu')).toBeVisible()
  await expect(mapper.getByText('MAAS ODEMESI').last()).toBeVisible()
  await mapper.getByLabel('Ad (isteğe bağlı)').fill('Örnek Bank')
  await mapper.getByRole('button', { name: 'Devam et · 3 işlem' }).click()

  // Mevcut önizleme hattı: başlık, bakiye kıyası, onay
  await expect(page.getByRole('heading', { name: 'Örnek Bank · hesap dökümü' })).toBeVisible()
  await expect(page.getByText('3 işlem okundu · sütunlar elle eşlendi')).toBeVisible()
  await expect(page.getByText(/Dönem başı bakiye ₺10\.000,00/)).toBeVisible()
  const offline = page.getByText(/Buluttaki en güncel kayıtlar alınamadı/)
  if (await offline.isVisible()) await offline.click()
  await page.getByRole('button', { name: /Onayla ve gir · 3 kayıt/ }).click()
  await expect(page.getByText('Ekstre işlendi')).toBeVisible()
  await expect(page.getByText(/3 kayıt eklendi/)).toBeVisible()

  // Aynı bankanın sonraki dökümü: eşleme hatırlanır, tek tıkla geçer
  await page.getByRole('button', { name: 'Başka ekstre yükle' }).click()
  await input.setInputFiles(memFile('ornek-banka-2.csv', csv([
    [addDays(d, 3), 'BIM KADIKOY', '250,00', '', '33.750,00'],
  ])))
  await expect(mapper.getByText(/daha önce “Örnek Bank” olarak eşlenmişti/)).toBeVisible()
  await mapper.getByRole('button', { name: 'Devam et · 1 işlem' }).click()
  await expect(page.getByRole('heading', { name: 'Örnek Bank · hesap dökümü' })).toBeVisible()
})
