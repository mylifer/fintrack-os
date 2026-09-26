import { test, expect, openApp } from './helpers'

/* Girişsiz (AUTH_BYPASS) kipte gerçek paylaşım denenemez — iki gerçek hesap
   ve 0021 gerekir. Burada arayüzün doğru kurulduğu ve oturumsuz davetin
   anlaşılır hatayla durduğu doğrulanır. */

test('aile paylaşımı kartı: alan oluşturma ve oturumsuz davet', async ({ page }) => {
  await openApp(page)
  await page.goto('/settings')
  await expect(page.getByText('Aile Paylaşımı')).toBeVisible()

  // Varsayılan dışında alan yok → önce paylaşılacak alan oluşturulur
  await page.getByRole('button', { name: 'Alan oluştur' }).click()
  await expect(page.getByRole('button', { name: 'Davet bağlantısı oluştur' })).toBeVisible()

  await page.getByRole('button', { name: 'Davet bağlantısı oluştur' }).click()
  // Oturum yok / sunucu hazır değil / bağlantı yok — hangisi olursa olsun anlaşılır ileti
  await expect(page.getByText(/yetkiniz yok|0021|Bağlantı yok|tekrar deneyin/)).toBeVisible()
  await expect(page.getByLabel('Davet bağlantısı')).toHaveCount(0)
})

test('davet sayfası: bozuk bağlantı anlaşılır hatayla durur', async ({ page }) => {
  await openApp(page)
  await page.goto('/davet/bozuk')
  await expect(page.getByText('Bağlantı eksik ya da bozuk.')).toBeVisible()
  await page.goto(`/davet/${'a'.repeat(64)}`)
  await expect(page.getByText(/yetkiniz yok|0021|geçersiz|Bağlantı yok|tekrar deneyin/)).toBeVisible()
})
