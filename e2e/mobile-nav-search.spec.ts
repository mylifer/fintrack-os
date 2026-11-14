import { test, expect, openApp } from './helpers'

/* Mobil "Diğer" menüsü ve genel arama (komut paleti). Telefon genişliğinde
   kenar çubuğu gizli; alt menüdeki "Diğer" tüm sayfalara ulaştırmalı. */

test.describe('mobil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('Diğer sayfası tüm gezinmeyi listeler ve gezinir', async ({ page }) => {
    await openApp(page)
    const bottom = page.getByRole('navigation', { name: 'Ana menü' })
    await expect(bottom.getByRole('link')).toHaveCount(4)

    await bottom.getByRole('button', { name: 'Diğer sayfalar' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tüm Sayfalar' })
    await expect(sheet).toBeVisible()
    for (const label of ['Ayarlar', 'Bütçeler', 'Borçlar', 'Ödeme Takibi', 'Ekstre Yükle', 'Hedefler', 'Abonelikler', 'Alıcılar']) {
      await expect(sheet.getByRole('link', { name: new RegExp(`^${label}`) })).toBeVisible()
    }

    // Esc kapatır
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // Dış tıklama kapatır (üst kenardaki karartma)
    await bottom.getByRole('button', { name: 'Diğer sayfalar' }).click()
    await expect(sheet).toBeVisible()
    await page.mouse.click(200, 20)
    await expect(sheet).toBeHidden()

    // Bağlantı gezinir, sayfa kapanır, "Diğer" aktif görünür
    await bottom.getByRole('button', { name: 'Diğer sayfalar' }).click()
    await sheet.getByRole('link', { name: /^Hedefler/ }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(sheet).toBeHidden()
  })

  test('Diğer → Ara paleti açar, sonuçla gezinir', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Diğer sayfalar' }).click()
    await page.getByRole('dialog', { name: 'Tüm Sayfalar' }).getByRole('button', { name: /Ara/ }).click()

    const palette = page.getByRole('dialog', { name: 'Genel arama' })
    const input = palette.getByRole('combobox')
    await expect(input).toBeFocused()
    await input.fill('odeme')
    await expect(palette.getByRole('option').first()).toContainText('Ödeme Takibi')
    await input.press('Enter')
    await expect(page).toHaveURL(/\/payments$/)
    await expect(palette).toBeHidden()

    // Boş durum
    await page.keyboard.press('Control+k')
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('qqqzzz')
    await expect(palette.getByText(/için sonuç yok/)).toBeVisible()
  })
})

test('masaüstü: Ctrl+K, ok tuşları ve kenar çubuğu girişi', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Genel arama' })
  const input = palette.getByRole('combobox')
  await expect(input).toBeFocused()

  await input.fill('ayar')
  await input.press('ArrowDown')
  await input.press('ArrowUp')
  await expect(palette.getByRole('option', { selected: true })).toContainText('Ayarlar')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/settings$/)

  await page.getByRole('complementary').getByRole('button', { name: /Ara…/ }).click()
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
})
