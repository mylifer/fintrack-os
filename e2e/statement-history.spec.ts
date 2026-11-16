import { test, expect, openApp, createAccount, memFile, trDate, addDays } from './helpers'

/* Ekstre Yükle: yeni alıcının adı satır penceresinde düzeltilir; onaylanan
   ekstre "Yüklenen Ekstreler"de kalır ve oradan işlemleri düzenlenir. */

const csv = (rows: [Date, string, string, string, string][]) =>
  ['Hesap No;TR00 0000', 'İşlem Tarihi;Açıklama;Borç;Alacak;Bakiye', ...rows.map(r => [trDate(r[0]), ...r.slice(1)].join(';'))].join('\n')

test('yeni alıcının adı düzeltilir; onaylanan ekstre Yüklenenler’de açılıp düzenlenir', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'E2E Vadesiz')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  const d = addDays(new Date(), -3)
  await page.goto('/ekstre-yukle')
  await page.locator('input[type=file][accept*="application/pdf"]').setInputFiles(memFile('gecmis-banka.csv', csv([
    [d, 'YENI DUKKAN KADIKOY', '500,00', '', '9.500,00'],
  ])))
  const mapper = page.getByTestId('column-mapper')
  await mapper.getByLabel('Ad (isteğe bağlı)').fill('Geçmiş Bank')
  await mapper.getByRole('button', { name: 'Devam et · 1 işlem' }).click()
  await expect(page.getByRole('heading', { name: 'Geçmiş Bank · hesap dökümü' })).toBeVisible()

  // Satır penceresi: alıcı arama kutusundan yeni alıcı eklenir, adı sonra düzeltilir
  await page.getByRole('button', { name: 'YENI DUKKAN KADIKOY ayrıntısı', exact: true }).click()
  const row = page.getByRole('dialog')
  await row.getByRole('radio', { name: 'Gider olarak gir' }).check()
  await row.getByRole('button', { name: 'Alıcı seçin' }).click()
  await page.getByPlaceholder('Ara...').fill('Mahalle')
  await page.getByRole('button', { name: /“Mahalle” ekle/ }).click()
  const name = row.getByLabel('Yeni alıcının adı')
  await expect(name).toHaveValue('Mahalle')
  await name.fill('Mahalle Bakkalı')
  await expect(row.getByRole('button', { name: 'Mahalle Bakkalı' })).toBeVisible()
  await row.getByRole('combobox').filter({ hasText: 'Seçin' }).click()
  await page.getByPlaceholder('Kategori ara...').fill('Bakkal Gideri')
  await page.getByRole('button', { name: /“Bakkal Gideri” kategorisini ekle/ }).click()
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/row-modal.png` })
  await row.getByRole('button', { name: 'Tamam' }).click()
  await expect(page.getByText('+ Mahalle Bakkalı').last()).toBeVisible()

  const offline = page.getByText(/Buluttaki en güncel kayıtlar alınamadı/)
  if (await offline.isVisible()) await offline.click()
  await page.getByRole('button', { name: /Onayla ve gir · 1 kayıt/ }).click()
  await expect(page.getByText('Ekstre işlendi')).toBeVisible()
  await expect(page.getByText(/1 yeni alıcı/)).toBeVisible()

  // Yüklenen Ekstreler: liste → ekstre → işlemi düzenle
  await page.getByRole('link', { name: 'Ekstrenin işlemleri' }).click()
  await expect(page.getByRole('heading', { name: 'Geçmiş Bank · hesap dökümü' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Bu ekstreden girilenler 1/ })).toBeVisible()
  await expect(page.getByText('Mahalle Bakkalı').first()).toBeVisible()
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/history-detail.png` })
  // Satırdaki "Düzenle" işlem düzenleme penceresini açar
  await page.getByText('YENI DUKKAN KADIKOY').first().hover()
  await page.getByTitle('Düzenle').first().click()
  const edit = page.getByRole('dialog')
  await expect(edit).toBeVisible()
  await expect(edit.locator('input[value="YENI DUKKAN KADIKOY"]')).toHaveCount(1)
  // Pencereler yalnız X ile kapanır (Esc/dış tıklama titretir)
  await edit.getByRole('button', { name: 'Kapat' }).click()
  await expect(edit).toHaveCount(0)
  await page.getByRole('tab', { name: /Dönemdeki tüm işlemler/ }).click()
  await expect(page.getByText('YENI DUKKAN KADIKOY').first()).toBeVisible()

  await page.goto('/ekstre-yukle/yuklenenler')
  await expect(page.getByRole('tab', { name: 'Ekstreler 1' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText(/1 satır · 1 kayıt girildi/)).toBeVisible()
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/history-list.png` })
  // Dönem içi listeler ayrı sekmede
  await page.getByRole('tab', { name: 'Dönem içi işlemler 0' }).click()
  await expect(page.getByText('Onaylanmış dönem içi işlem listesi yok.')).toBeVisible()
  await page.goto('/ekstre-yukle/taslaklar')
  await expect(page.getByText('Yarım kalan ekstre yok')).toBeVisible()
})

test('yüklenen ekstre listeden geri alınır: kayıtları silinir, taslağa döner', async ({ page }) => {
  await openApp(page)
  const dlg = await createAccount(page, 'E2E Yanlış Hesap')
  await dlg.getByRole('button', { name: 'Kaydet' }).click()
  await expect(dlg).toHaveCount(0)

  const d = addDays(new Date(), -2)
  await page.goto('/ekstre-yukle')
  await page.locator('input[type=file][accept*="application/pdf"]').setInputFiles(memFile('geri-al.csv', csv([
    [d, 'GERI ALINACAK MARKET', '120,00', '', '880,00'],
    [d, 'GERI ALINACAK KAFE', '80,00', '', '800,00'],
  ])))
  const mapper = page.getByTestId('column-mapper')
  await mapper.getByLabel('Ad (isteğe bağlı)').fill('Geri Bank')
  await mapper.getByRole('button', { name: /Devam et · 2 işlem/ }).click()
  await expect(page.getByRole('heading', { name: 'Geri Bank · hesap dökümü' })).toBeVisible()
  for (const line of ['GERI ALINACAK MARKET', 'GERI ALINACAK KAFE']) {
    await page.getByRole('button', { name: `${line} ayrıntısı`, exact: true }).click()
    const row = page.getByRole('dialog')
    await row.getByRole('radio', { name: 'Gider olarak gir' }).check()
    await row.getByRole('combobox').filter({ hasText: 'Seçin' }).click()
    const cat = `Gider ${line.split(' ').pop()}`
    await page.getByPlaceholder('Kategori ara...').fill(cat)
    await page.getByRole('button', { name: new RegExp(`“${cat}” kategorisini ekle`) }).click()
    await row.getByRole('button', { name: 'Tamam' }).click()
    await expect(row).toHaveCount(0)
  }
  const offline = page.getByText(/Buluttaki en güncel kayıtlar alınamadı/)
  if (await offline.isVisible()) await offline.click()
  await page.getByRole('button', { name: /Onayla ve gir · 2 kayıt/ }).click()
  await expect(page.getByText('Ekstre işlendi')).toBeVisible()

  await page.goto('/ekstre-yukle/yuklenenler')
  await expect(page.getByText(/2 satır · 2 kayıt girildi/)).toBeVisible()
  await page.getByRole('button', { name: 'Geri al', exact: true }).click()
  await expect(page.getByText(/Bu ekstreden girilen 2 kayıt silinecek/)).toBeVisible()
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/history-undo-confirm.png` })
  await page.getByRole('button', { name: 'Geri al', exact: true }).click()
  await expect(page.getByText(/geri alındı: 2 kayıt silindi/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Hesabı seçip yeniden yükle/ })).toBeVisible()
  await expect(page.getByText(/2 satır · 2 kayıt girildi/)).toHaveCount(0)
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/history-undo-done.png` })

  // Kayıtlar silindi
  await page.goto('/transactions')
  await expect(page.getByRole('heading').first()).toBeVisible()
  await expect(page.getByText('GERI ALINACAK MARKET')).toHaveCount(0)

  // Ekstre yarım kalan taslak olarak döndü; açılınca hesap seçilip yeniden onaylanabilir
  await page.goto('/ekstre-yukle/taslaklar')
  await expect(page.getByText(/Geri Bank/).first()).toBeVisible()
  await page.goto('/ekstre-yukle/yuklenenler')
  await expect(page.getByText('Yüklenmiş ekstre yok')).toBeVisible()
})
