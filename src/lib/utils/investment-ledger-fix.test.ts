import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { findMislabeledInvestmentRows, planLedgerFixes, rateOn } from './investment-ledger-fix'

const accounts = [
  { id: 'try', currency: 'TRY' as const },
  { id: 'usd', currency: 'USD' as const },
  { id: 'eur', currency: 'EUR' as const },
]

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: 'x', type: 'expense', amount: 10_000, currency: 'TRY', date: '2026-03-10', accountId: 'usd',
    icon: 'Au', description: '2 Gr Altın Alımı', isInstallment: false, createdAt: '', updatedAt: '',
    ...p,
  } as Transaction
}

describe('findMislabeledInvestmentRows', () => {
  it('döviz hesabına TRY etiketiyle yazılmış alım, satış, kâr/zarar ve stopaj satırlarını bulur', () => {
    const rows = [
      tx({ id: 'alim' }),
      tx({ id: 'satis', type: 'income', description: '2 Gr Altın Satışı' }),
      tx({ id: 'kar', type: 'income', description: 'Gr Altın Satış Kârı' }),
      tx({ id: 'stopaj', description: 'AFA Satış Stopajı', icon: 'F', accountId: 'eur' }),
    ]
    expect(findMislabeledInvestmentRows(rows, accounts).map(t => t.id)).toEqual(['alim', 'satis', 'kar', 'stopaj'])
  })

  it('doğru satırlara ve yatırım dışı kayıtlara dokunmaz', () => {
    const rows = [
      tx({ id: 'tl-hesap', accountId: 'try' }),                                        // TL hesap: zaten doğru
      tx({ id: 'zaten-usd', currency: 'USD', amount: 250 }),                          // yeni/düzeltilmiş satır
      tx({ id: 'ikonsuz', icon: undefined }),                                         // kullanıcının kendi kaydı
      tx({ id: 'transfer', icon: '⇄', description: 'Aileye aktarım' }),               // alanlar arası transfer
      tx({ id: 'silinmis', deleted_at: '2026-04-01T00:00:00.000Z' }),
      tx({ id: 'hesap-yok', accountId: 'bilinmeyen' }),
    ]
    expect(findMislabeledInvestmentRows(rows, accounts)).toEqual([])
  })
})

describe('rateOn', () => {
  const pts = [
    { date: '2026-03-06', price: 37 },   // Cuma
    { date: '2026-03-09', price: 38 },   // Pazartesi
    { date: '2026-03-10', price: 38.5 },
  ]
  it('o günün kuru', () => expect(rateOn(pts, '2026-03-10')).toBe(38.5))
  it('hafta sonu → önceki son kapanış', () => expect(rateOn(pts, '2026-03-08')).toBe(37))
  it('seri işlemden sonra başlıyorsa ilk nokta', () => expect(rateOn(pts, '2026-03-01')).toBe(37))
  it('boş seri → null', () => expect(rateOn([], '2026-03-10')).toBeNull())
})

describe('planLedgerFixes', () => {
  it('İŞLEM GÜNÜNÜN kuruyla çevirir, TL değeri amountTry olarak korur', () => {
    const fixes = planLedgerFixes(
      [tx({ id: 'alim', amount: 10_000, amountTry: 10_000, date: '2026-03-10' })],
      accounts,
      { USD: [{ date: '2026-03-10', price: 40 }, { date: '2026-10-20', price: 42 }] },
    )
    expect(fixes).toEqual([{ id: 'alim', patch: { amount: 250, currency: 'USD', amountTry: 10_000 } }])
  })

  it('kuru bulunamayan satırı atlar (yanlış kurla yazmaz)', () => {
    expect(planLedgerFixes([tx({ id: 'alim' })], accounts, { USD: [] })).toEqual([])
  })
})
