import { test, expect, openApp, createAccount } from './helpers'

test('tutarları gizle', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Gizli Hesap', { opening: '12345' })
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByText('Gizli Hesap').first()).toBeVisible()

  await page.getByRole('button', { name: 'Tutarları gizle' }).first().click()
  await expect(page.locator('body')).toContainText('₺•••')
  expect(await page.locator('body').innerText()).not.toMatch(/₺\d/)

  await page.getByRole('button', { name: 'Tutarları göster' }).first().click()
  await expect(page.locator('body')).toContainText(/₺\d/)
})

test('PIN kilidi: belirle, kilitle, yanlış/doğru PIN, yenileyince kilitli, kaldır', async ({ page }) => {
  await openApp(page)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'PIN Belirle' }).click()
  await page.locator('[id="yeni-pin-(4–8-rakam)"]').fill('482915')
  await page.locator('[id="yeni-pin-tekrar"]').fill('482915')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await page.getByRole('button', { name: 'Şimdi Kilitle' }).click()
  await expect(page.getByText('FinTrack OS kilitli')).toBeVisible()
  await page.getByLabel('PIN').fill('111111')
  await page.getByRole('button', { name: 'Kilidi Aç' }).click()
  await expect(page.getByText('PIN hatalı.')).toBeVisible()
  await page.getByLabel('PIN').fill('482915')
  await page.getByRole('button', { name: 'Kilidi Aç' }).click()
  await expect(page.getByText('FinTrack OS kilitli')).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('FinTrack OS kilitli')).toBeVisible()
  await page.getByLabel('PIN').fill('482915')
  await page.getByRole('button', { name: 'Kilidi Aç' }).click()

  await page.getByText('Kilidi kaldır').click()
  await page.locator('[id="mevcut-pin"]').fill('482915')
  await page.getByRole('button', { name: 'Kilidi Kaldır' }).click()
  await expect(page.getByRole('button', { name: 'PIN Belirle' })).toBeVisible()
  await page.reload()
  await page.waitForTimeout(1000)
  await expect(page.getByText('FinTrack OS kilitli')).toHaveCount(0)
})
