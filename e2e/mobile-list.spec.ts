import { test, expect, openApp, createAccount } from './helpers'
import type { Page } from '@playwright/test'

/* Telefon genişliğinde işlem listesi ve filtreleri.

   Masaüstü tablosu 9 sütunlu ve ~900px geniştir; telefonda TUTAR sütunu ekranın
   dışında kalıyordu ve satır işlemleri (iade, kural, sil) yalnız hover'da
   göründüğü için dokunmatikte hiç açılamıyordu. Filtreler ise altı açılır menü
   olarak ekranın yarısını yiyordu. */

test.use({ viewport: { width: 393, height: 852 } })

/** Bir hesap + bir gider işlemi (her testin kendi tarayıcı bağlamı boş başlar). */
async function seed(page: Page, desc: string, amount: string) {
  await openApp(page)
  const acc = await createAccount(page, 'Mobil Banka')
  await acc.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Mobil Banka').filter({ visible: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'İşlem ekle' }).click()
  const form = page.getByRole('dialog', { name: 'İşlem Ekle' })
  await form.getByLabel('Tutar').fill(amount)
  await form.getByPlaceholder('Migros, Maaş, Kira...').fill(desc)
  const combos = form.getByRole('combobox')
  await combos.nth(0).click()
  await page.getByRole('option', { name: /Mobil Banka/ }).click()
  await combos.nth(1).click()
  await page.getByText('Diğer Gider', { exact: true }).click()
  await form.getByRole('button', { name: /^Kaydet/ }).last().click()
  await expect(form).toBeHidden()
}

test('telefonda işlem listesi: tutar ekranda, satır dokunulabilir, satır işlemleri açılır', async ({ page }) => {
  await seed(page, 'Kahveci Zeynep', '1234,56')
  await page.goto('/transactions')
  const row = page.getByText('Kahveci Zeynep').first()
  await expect(row).toBeVisible()

  // 1) Tutar görünür VE tamamı ekranın içinde
  const amount = page.getByText('1.234,56').first()
  await expect(amount).toBeVisible()
  const box = await amount.boundingBox()
  expect(box, 'tutarın konumu').not.toBeNull()
  expect(box!.x + box!.width, 'tutar ekranın sağına taşmamalı').toBeLessThanOrEqual(393)

  // 2) Sayfa yatay kaydırmıyor
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'yatay taşma').toBeLessThanOrEqual(0)

  // 3) Satıra dokunmak düzenlemeyi açar
  await row.click()
  const edit = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Migros, Maaş, Kira...') })
  await expect(edit.getByPlaceholder('Migros, Maaş, Kira...')).toHaveValue('Kahveci Zeynep')
  await edit.getByRole('button', { name: 'Kapat' }).first().click()
  await expect(edit).toBeHidden()

  // 4) "⋯" satır işlemleri: iade ve silme dokunmatikte de erişilebilir
  await page.getByRole('button', { name: 'Kahveci Zeynep işlemleri', exact: true }).click()
  const sheet = page.getByRole('dialog').filter({ hasText: 'İade işle' })
  await expect(sheet.getByRole('button', { name: 'İade işle' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Sil' })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /kural oluştur/i })).toBeVisible()
})

test('telefonda filtreler tek düğmede toplanır ve uygulanır', async ({ page }) => {
  await seed(page, 'Kahveci Zeynep', '1234,56')
  await page.goto('/transactions')
  await expect(page.getByText('Kahveci Zeynep').first()).toBeVisible()

  // Açılır menüler satırda değil, "Filtrele" sayfasında
  await expect(page.getByRole('combobox', { name: /Tüm Kategoriler/ })).toBeHidden()
  await page.getByRole('button', { name: /^Filtrele/ }).click()
  const sheet = page.getByRole('dialog').filter({ hasText: 'Filtrele ve sırala' })
  await expect(sheet).toBeVisible()

  // Tür = Gelir → tek gider satırı elenir, düğmede açık filtre sayısı görünür
  await sheet.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Gelir', exact: true }).click()
  await sheet.getByRole('button', { name: /işlemi göster/ }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('button', { name: /^Filtrele/ })).toContainText('1')
  await expect(page.getByText('Kahveci Zeynep')).toHaveCount(0)

  // Temizle → satır geri gelir
  await page.getByRole('button', { name: /^Filtrele/ }).click()
  await sheet.getByRole('button', { name: 'Temizle' }).click()
  await sheet.getByRole('button', { name: /işlemi göster/ }).click()
  await expect(page.getByText('Kahveci Zeynep').first()).toBeVisible()
})

/* Kategoriler ve Alıcılar panolarında "Tablo" görünümü 640–660px'lik yoğun bir
   tablodur: telefonda sütunların çoğu ancak yan kaydırılarak görünür. lg altında
   kayıtlı tercih ne olursa olsun "Dizin" basılır. */
test('telefonda kategori panosu: kayıtlı tercih tablo olsa da dizin basılır', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('categories.viewMode', 'table'))
  await page.goto('/categories')
  await expect(page.getByRole('heading', { name: 'Kategoriler' })).toBeVisible()
  await page.waitForTimeout(600)

  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
    const r = el.getBoundingClientRect()
    return r.width > document.documentElement.clientWidth + 4 && r.height > 8 && getComputedStyle(el).position !== 'fixed'
  }).length)
  expect(wide, 'ekrandan geniş öğe').toBe(0)
  // Görünüm seçici yalnız masaüstünde
  await expect(page.getByRole('button', { name: 'Tablo', exact: true })).toBeHidden()
})
