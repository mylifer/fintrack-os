import { test, expect, openApp, createAccount } from './helpers'

/* İşlem değişiklik geçmişi (audit log): bir işlem oluşturulup düzenlenince,
   düzenleme penceresindeki "Bu kaydın geçmişi" bölümü ne zaman / ne yapıldı /
   hangi alan eski → yeni bilgisini gösterir. */

test('işlem geçmişi düzenleme penceresinde görünür', async ({ page }) => {
  await openApp(page)
  const acc = await createAccount(page, 'E2E Kart')
  await acc.getByRole('button', { name: 'Kaydet' }).click()
  await expect(acc).toHaveCount(0)

  // ── İşlem oluştur ──
  await page.goto('/transactions')
  await page.getByRole('button', { name: 'Ekle' }).first().click()
  const form = page.getByRole('dialog')
  await form.getByPlaceholder('Migros, Maaş, Kira...').fill('Telefon Ekran Koruyucu')
  await form.getByLabel('Tutar').fill('219,90')
  // Hesap ve kategori: ilk seçenekler
  await form.getByRole('combobox').nth(0).click()
  await page.getByRole('option').first().click()
  // Kategori: CategoryCascadeSelect (role=option değil) — arayıp yaprak kategori seç
  await form.getByRole('combobox').nth(1).click()
  await page.getByPlaceholder('Kategori ara...').fill('Banka Giderleri')
  await page.getByText('Banka Giderleri', { exact: true }).last().click()
  await form.getByRole('button', { name: 'Kaydet' }).click()
  await expect(form).toHaveCount(0)

  // ── Düzenle: tutarı değiştir ──
  await page.getByText('Telefon Ekran Koruyucu').first().hover()
  await page.getByTitle('Düzenle').first().click()
  const edit = page.getByRole('dialog')
  await edit.getByLabel('Tutar').fill('199,90')
  await edit.getByRole('button', { name: 'Güncelle' }).click()
  await expect(edit).toHaveCount(0)

  // ── Geçmiş paneli ──
  await page.getByText('Telefon Ekran Koruyucu').first().hover()
  await page.getByTitle('Düzenle').first().click()
  const again = page.getByRole('dialog')
  const toggle = again.getByRole('button', { name: 'Bu kaydın geçmişi' })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(again.getByText('Düzenlendi').first()).toBeVisible()
  await expect(again.getByText('Oluşturuldu').first()).toBeVisible()
  await expect(again.getByText(/Tutar:/).first()).toBeVisible()
  await again.getByText(/Tutar:/).first().scrollIntoViewIfNeeded()
  if (process.env.SHOT_DIR) await again.screenshot({ path: `${process.env.SHOT_DIR}/history-panel.png` })
})
