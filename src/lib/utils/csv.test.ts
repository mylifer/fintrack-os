import { describe, it, expect } from 'vitest'
import { transactionsToCsvString, parseCsvText, csvFilenameSlug, autoDetectMapping, validateImportRows } from './csv'
import type { Account, Category, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   csv — dışa/içe aktarım

   Kritik değişmez: uygulamanın KENDİ çıktısı kendi ayrıştırıcısı tarafından
   okunabilmeli (round-trip). Kullanıcı dışa aktarıp Excel'de düzenleyip geri
   yüklüyor; bu zincir kopunca veri sessizce kayboluyor.
──────────────────────────────────────────────────────────────────────── */

const cats: Category[] = [
  { id: 'c1', name: 'Market', icon: 'x', color: '#000', scope: 'expense', isSystem: false, isArchived: false, sortOrder: 0 },
]
const accs: Account[] = [
  { id: 'a1', name: 'Vadesiz', type: 'checking', currency: 'TRY', balance: 0, initialBalance: 0, color: '#000', isArchived: false, createdAt: '2026-01-01' },
  { id: 'a2', name: 'Birikim', type: 'savings',  currency: 'TRY', balance: 0, initialBalance: 0, color: '#000', isArchived: false, createdAt: '2026-01-01' },
]

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount'>): Transaction {
  return {
    currency: 'TRY', date: '2026-03-01', accountId: 'a1', description: 'Alışveriş',
    isInstallment: false, createdAt: '2026-03-01', updatedAt: '2026-03-01', ...p,
  }
}

/** Dışa aktarılan CSV'yi ayrıştırıp ilk veri satırını sözlük olarak verir. */
function roundTrip(transactions: Transaction[]) {
  const parsed = parseCsvText(transactionsToCsvString(transactions, cats, accs))
  return { parsed, first: parsed.rows[0] }
}

describe('transactionsToCsvString — başlık ve alanlar', () => {
  it('sabit başlık sırasını korur (dış betikler bozulmasın)', () => {
    const { parsed } = roundTrip([tx({ id: 't1', type: 'expense', amount: 250 })])
    expect(parsed.headers).toEqual([
      'Tarih', 'Açıklama', 'Kategori', 'Tutar', 'Tür', 'Para Birimi', 'Etiketler', 'Hesap', 'Karşı Hesap',
    ])
  })

  it('kategori ve hesap adlarını id yerine yazar', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 250, categoryId: 'c1' })])
    expect(first['Kategori']).toBe('Market')
    expect(first['Hesap']).toBe('Vadesiz')
  })

  it('transferin karşı hesabını yazar', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'transfer', amount: 100, toAccountId: 'a2' })])
    expect(first['Tür']).toBe('Transfer')
    expect(first['Karşı Hesap']).toBe('Birikim')
  })

  it('çözülemeyen kategori/hesap referansı boş hücre olur (çökmez)', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, categoryId: 'silinmis', accountId: 'yok' })])
    expect(first['Kategori']).toBe('')
    expect(first['Hesap']).toBe('')
  })

  it('tutarı iki ondalıkla yazar', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 1234.5 })])
    expect(first['Tutar']).toBe('1234.50')
  })
})

describe('parseCsvText — alıntı farkındalığı', () => {
  it('virgül içeren hücreyi tek alan olarak okur', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, description: 'Market, akşam' })])
    expect(first['Açıklama']).toBe('Market, akşam')
  })

  it('çift tırnak içeren açıklamayı kaçırıp geri okur', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, description: 'Kitap "Dune"' })])
    expect(first['Açıklama']).toBe('Kitap "Dune"')
  })

  it('satır içi yeni satırı tek kayıt olarak korur', () => {
    const { parsed, first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, description: 'iki\nsatır' })])
    expect(parsed.rows).toHaveLength(1)
    expect(first['Açıklama']).toBe('iki\nsatır')
  })

  it('BOM ve CRLF ile başa çıkar', () => {
    const parsed = parseCsvText('﻿Tarih,Açıklama\r\n2026-03-01,Test\r\n')
    expect(parsed.headers).toEqual(['Tarih', 'Açıklama'])
    expect(parsed.rows[0]['Açıklama']).toBe('Test')
  })

  it('boş satırları atlar ve kaynak satır numarasını taşır', () => {
    const parsed = parseCsvText('Tarih,Açıklama\n\n2026-03-01,Test\n')
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rowLines[0]).toBe(3)
  })
})

describe('yardımcılar', () => {
  it('csvFilenameSlug Türkçe karakterleri indirger', () => {
    expect(csvFilenameSlug('Ziraat Çek Hesabı')).toBe('ziraat-cek-hesabi')
  })

  it('autoDetectMapping bilinen başlıkları eşler', () => {
    const m = autoDetectMapping(['Tarih', 'Açıklama', 'Tutar', 'Tür'])
    expect(m['date']).toBe('Tarih')
    expect(m['amount']).toBe('Tutar')
  })
})

/* ── Negatif tutar (iade) round-trip'i ─────────────────────────────────────
   Denetim bulgusu #25 (düzeltildi). escapeCsvCell formül enjeksiyonuna karşı
   `=+-@` ile başlayan hücreye tek tırnak ekliyor; iade satırları BİLEREK
   negatif tutarlı yazıldığı için (supabase_schema.sql:135-140) "-250.00"
   hücresi "'-250.00" olarak dışa aktarılıyor ve uygulamanın kendi çıktısı
   geri yüklenemiyordu.

   Düzeltme düz sayıları (PLAIN_NUMBER) kaçış dışında bırakır. Aşağıdaki son
   iki test korumanın gerçek formüllerde HÂLÂ çalıştığını doğrular — düzeltmenin
   güvenlik açığı yaratmadığının kapısı.
──────────────────────────────────────────────────────────────────────── */
describe('negatif tutar — düzeltilen hata #25', () => {
  it('negatif tutar tek tırnakla kaçırılmaz', () => {
    const { first } = roundTrip([tx({ id: 'r1', type: 'expense', amount: -250, description: '[İade] Ayakkabı' })])
    expect(first['Tutar']).toBe('-250.00')
  })

  it('dışa aktarılan negatif tutar geri okunduğunda sayı olarak ayrıştırılır', () => {
    const { first } = roundTrip([tx({ id: 'r1', type: 'expense', amount: -250, description: '[İade] Ayakkabı' })])
    expect(Number(first['Tutar'])).toBe(-250)
  })

  it('gerçek formül girdileri hâlâ etkisizleştirilir', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, description: '=SUM(A1:A9)' })])
    expect(first['Açıklama']).toBe("'=SUM(A1:A9)")
  })

  it('sayıya benzeyen ama formül olan açıklama kaçırılır', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 10, description: '-1+1' })])
    expect(first['Açıklama']).toBe("'-1+1")
  })

  it('pozitif tutar round-trip zaten sağlam (regresyon koruması)', () => {
    const { first } = roundTrip([tx({ id: 't1', type: 'expense', amount: 250 })])
    expect(Number(first['Tutar'])).toBe(250)
  })
})

/* ── Takvimde olmayan tarih ────────────────────────────────────────────────
   `new Date('2026-04-31')` hata vermeyip 1 Mayıs'a taştığı için bu tarihler
   geçerli sayılıp kaydediliyordu; tarih text sütunda buluta gidiyor ve
   `format(parseISO(...))` dashboard'u RangeError ile çökertiyordu. */
describe('içe aktarma tarihi — takvimde olmayan gün reddedilir', () => {
  const mapping = { date: 'Tarih', description: 'Açıklama', amount: 'Tutar', type: 'Tür' }
  const row = (Tarih: string) => ({ Tarih, 'Açıklama': 'Test', Tutar: '100', 'Tür': 'gider' })

  it.each(['31.04.2026', '2026-04-31', '29.02.2026', '2026-02-30', '2026-13-01', '00.01.2026'])('%s reddedilir', raw => {
    const { valid, errors } = validateImportRows([row(raw)], mapping, cats)
    expect(valid).toHaveLength(0)
    expect(errors[0].message).toContain('Geçersiz tarih')
  })

  it.each([
    ['29.02.2028', '2028-02-29'],
    ['31/12/2026', '2026-12-31'],
    ['1.3.2026',   '2026-03-01'],
    ['2026-04-30', '2026-04-30'],
  ])('%s → %s', (raw, iso) => {
    const { valid } = validateImportRows([row(raw)], mapping, cats)
    expect(valid[0]?.date).toBe(iso)
  })
})

/* ── Negatif tutarın içe aktarılması ───────────────────────────────────────
   Dışa aktarma iade satırını "-250.00" yazıyordu ama parseAmount `n <= 0`
   reddettiği için satır "Geçersiz tutar" alıyordu — round-trip kopuktu. */
describe('içe aktarma — negatif tutar (iade)', () => {
  const mapping = { date: 'Tarih', description: 'Açıklama', amount: 'Tutar', type: 'Tür' }
  const row = (Tutar: string, tur = 'gider') => ({ Tarih: '2026-03-01', 'Açıklama': 'Test', Tutar, 'Tür': tur })

  it('uygulamanın dışa aktardığı iade satırı negatif gider olarak geri gelir', () => {
    const parsed = parseCsvText(transactionsToCsvString(
      [tx({ id: 'r1', type: 'expense', amount: -250, description: '[İade] Ayakkabı' })], cats, accs,
    ))
    const { valid, errors } = validateImportRows(parsed.rows, autoDetectMapping(parsed.headers), cats, parsed.rowLines)
    expect(errors).toEqual([])
    expect(valid[0]).toMatchObject({ type: 'expense', amount: -250, description: '[İade] Ayakkabı' })
  })

  it('TR biçimli negatif tutarı ayrıştırır', () => {
    expect(validateImportRows([row('-1.234,56')], mapping, cats).valid[0]?.amount).toBe(-1234.56)
  })

  it('negatif gelir reddedilir', () => {
    const { valid, errors } = validateImportRows([row('-100', 'gelir')], mapping, cats)
    expect(valid).toHaveLength(0)
    expect(errors[0].message).toContain('yalnızca gider')
  })

  it('sıfır tutar hâlâ reddedilir', () => {
    expect(validateImportRows([row('0')], mapping, cats).errors[0].message).toContain('Geçersiz tutar')
  })
})
