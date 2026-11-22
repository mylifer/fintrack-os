import { test, expect, openApp } from './helpers'

/* Telefon kabuğu: üst çubuk. Genel arama eskiden yalnız alt menüdeki "Diğer"
   sayfasının içinden açılabiliyordu; bildirim zili ve gizlilik düğmesi ise
   Header'a bağlı olduğundan Header kullanmayan sayfalarda (Yatırımlar, detay
   sayfaları) mobilde hiç görünmüyordu — Header'ı olan sayfalarda ise gizlilik
   düğmesi iki kez çıkıyordu. Üçü de artık üst çubukta, her sayfada bir kez. */

test.use({ viewport: { width: 393, height: 852 } })

test('telefonda üst çubuk: arama, bildirim ve gizlilik her sayfada birer kez', async ({ page }) => {
  await openApp(page)

  for (const route of ['/dashboard', '/investments', '/transactions']) {
    await page.goto(route)
    await expect(page.getByRole('button', { name: 'Ara', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Bildirimler/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Tutarları (gizle|göster)/ })).toHaveCount(1)
  }

  // Arama her sayfadan tek dokunuşla açılır ve sayfalara gider
  await page.goto('/investments')
  await page.getByRole('button', { name: 'Ara', exact: true }).click()
  const palette = page.getByRole('dialog', { name: 'Genel arama' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('kategori')
  await palette.getByRole('combobox').press('Enter')
  await expect(palette).toBeHidden()
  await expect(page).toHaveURL(/\/categories/)
})
