import { test, expect, openApp, createAccount, addDays, iso } from './helpers'

test('vadeli mevduat: koşullar → vade dolunca faizi işle ve yenile', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'Mevduat E2E', { type: 'Vadeli Hesap', opening: '100000' })
  await dlg.locator('[id="yıllık-faiz-(%)"]').fill('45')
  // 32 gün önce başlayan vade bugün dolar
  await dlg.locator('[id="vade-başlangıcı"]').fill(iso(addDays(new Date(), -32)))
  await dlg.getByRole('button', { name: '32 gün' }).click()
  await expect(dlg.locator('[id="vade-sonu"]')).toHaveValue(iso(new Date()))
  // 100.000 × %45 × 32/365 = 3.945,21 brüt; %17,5 stopaj → 3.254,80 net
  await expect(dlg).toContainText('3.254,80')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  await page.getByText('Mevduat E2E').first().click()
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/)
  await expect(page.getByText('Vade doldu').first()).toBeVisible()
  await expect(page.locator('body')).toContainText('103.254,80')

  await page.getByRole('button', { name: /Faizi işle ve 32 gün yenile/ }).click()
  await expect(page.getByText(/3\.254,80 net faiz .* hesaba işlendi/)).toBeVisible()
  await expect(page.locator('body')).toContainText('Vadeli mevduat faizi')
  await expect(page.getByText('32 gün kaldı')).toBeVisible()
})
