import { describe, it, expect } from 'vitest'
import type { RecurringTransaction, Transaction } from '@/types'
import { detectRecurring, recurringKeyText, suggestionName, suggestionToRecurring } from './recurring-detect'

let n = 0
const tx = (o: Partial<Transaction>): Transaction => ({
  id: `t${n++}`, type: 'expense', amount: 100, currency: 'TRY', date: '2026-09-01',
  accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})
const asOf = '2026-09-26'
const monthly = (desc: string, day: string, amounts: number[], o: Partial<Transaction> = {}) =>
  amounts.map((amount, i) => tx({ description: desc, amount, date: `2026-0${9 - amounts.length + 1 + i}-${day}`, ...o }))

describe('recurringKeyText', () => {
  it('rakam ve noktalama atılır, ilk 3 kelime', () => {
    expect(recurringKeyText('MİGROS 1234 KADIKÖY/İST')).toBe('migros kadikoy ist')
    expect(recurringKeyText('Kira - Eylül 2026')).toBe('kira')
    expect(recurringKeyText('EV KIRASI HAZİRAN')).toBe(recurringKeyText('Ev kirası temmuz'))
  })

  it('öneri adı: özgün yazım, ay adı ve rakamlar atılır', () => {
    expect(suggestionName('EV KIRASI EYLUL')).toBe('EV KIRASI')
    expect(suggestionName('Kira - Eylül 2026')).toBe('Kira')
    expect(suggestionName('MAAS ODEMESI 202609')).toBe('MAAS ODEMESI')
    expect(suggestionName('2026/09')).toBe('2026/09')   // hepsi atılırsa özgün kalır
  })
})

describe('detectRecurring', () => {
  it('aylık kira ve maaş önerilir; bir sonraki tarih ve gün', () => {
    const txs = [
      ...monthly('Ev Kirası', '03', [15000, 15000, 15000, 15000]),
      ...monthly('MAAS ODEMESI 202609', '15', [60000, 60000, 62000], { type: 'income' }),
    ]
    const s = detectRecurring(txs, [], { asOf })
    expect(s.map(x => x.name)).toEqual(['MAAS ODEMESI', 'Ev Kirası'])
    expect(s[1]).toMatchObject({ amount: 15000, count: 4, lastDate: '2026-09-03', nextDate: '2026-10-03', dayOfMonth: 3, amountVaries: false })
    expect(s[0]).toMatchObject({ type: 'income', amountVaries: true })
  })

  it('ayda birden çok kez (market), düzensiz gün, oynak tutar elenir', () => {
    const market = [...monthly('Migros', '05', [800, 900, 750]), ...monthly('Migros', '20', [600, 700, 650])]
    const gun = [tx({ description: 'Spor', date: '2026-07-02' }), tx({ description: 'Spor', date: '2026-08-20' }), tx({ description: 'Spor', date: '2026-09-10' })]
    const tutar = monthly('Elektrik', '10', [300, 900, 400])
    expect(detectRecurring([...market, ...gun, ...tutar], [], { asOf })).toEqual([])
  })

  it('ay sonu günleri (28–31) aynı gün sayılır', () => {
    const txs = [
      tx({ description: 'Aidat', date: '2026-06-30' }),
      tx({ description: 'Aidat', date: '2026-07-31' }),
      tx({ description: 'Aidat', date: '2026-08-31' }),
    ]
    expect(detectRecurring(txs, [], { asOf })).toHaveLength(1)
  })

  it('bitmiş (45 günden uzun sessiz), 3 aydan az, taksit/yatırım satırı önerilmez', () => {
    const eski = [tx({ description: 'Gym', date: '2026-04-05' }), tx({ description: 'Gym', date: '2026-05-05' }), tx({ description: 'Gym', date: '2026-06-05' })]
    const iki = monthly('Netflix', '12', [229, 229])
    const taksit = monthly('Telefon', '08', [1000, 1000, 1000], { isInstallment: true, installGroupId: 'g' })
    const yatirim = monthly('10 Gr Altın Alımı', '01', [5000, 5000, 5000], { icon: 'Au' })
    expect(detectRecurring([...eski, ...iki, ...taksit, ...yatirim], [], { asOf })).toEqual([])
  })

  it('şablonu olan (açıklama ya da alıcı) ve gizlenen öneri çıkmaz', () => {
    const txs = [...monthly('Ev Kirası', '03', [15000, 15000, 15000]), ...monthly('Su faturası 123', '11', [200, 210, 205], { recipientId: 'iski' })]
    const tmpl = (o: Partial<RecurringTransaction>) => ({ id: 'r', name: 'x', type: 'expense', amount: 1, currency: 'TRY', accountId: 'a', description: '', frequency: 'monthly', startDate: '', nextDueDate: '', isActive: true, createdAt: '', ...o }) as RecurringTransaction
    expect(detectRecurring(txs, [tmpl({ name: 'Ev kirası' })], { asOf }).map(s => s.name)).toEqual(['Su faturası'])
    expect(detectRecurring(txs, [tmpl({ recipientId: 'iski' })], { asOf }).map(s => s.name)).toEqual(['Ev Kirası'])
    const all = detectRecurring(txs, [], { asOf })
    expect(detectRecurring(txs, [], { asOf, dismissed: [all[0].key] })).toHaveLength(1)
  })

  it('şablon bir sonraki ödemeden başlar', () => {
    const [s] = detectRecurring(monthly('Ev Kirası', '03', [15000, 15000, 15000], { categoryId: 'kira' }), [], { asOf })
    expect(suggestionToRecurring(s, 'id1', 'now')).toMatchObject({
      frequency: 'monthly', startDate: '2026-10-03', nextDueDate: '2026-10-03', amount: 15000, categoryId: 'kira', isActive: true,
    })
  })
})
