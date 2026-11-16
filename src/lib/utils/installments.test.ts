import { describe, it, expect } from 'vitest'
import { collapseInstallments, rebalanceInstallmentsBelow, findInstallmentRoundingFixes, findInstallmentSplitFixes } from './installments'
import { rescaleSplits, splitsForInstallments } from './categorySplits'
import { splitInstallments } from './money'
import { calcPeriodFlow, excludeFuture, sumExpenseByKey } from './calculations'
import type { Transaction } from '@/types'

/* ── Factory ────────────────────────────────────────────────────────── */

let seq = 0
function tx(over: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `t-${seq}`,
    type: 'expense',
    amount: 100,
    amountTry: 100,
    currency: 'TRY',
    date: '2026-01-15',
    accountId: 'acc-1',
    description: `İşlem ${seq}`,
    isInstallment: false,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...over,
  }
}

/** 12.000₺'lik 3 taksitli alışveriş: Ocak / Şubat / Mart. */
function group(groupId = 'g-1', amounts = [4000, 4000, 4000]): Transaction[] {
  return amounts.map((amount, i) =>
    tx({
      amount,
      amountTry: amount,
      date: `2026-0${i + 1}-15`,
      description: 'Buzdolabı',
      categoryId: 'cat-ev',
      isInstallment: true,
      installTotal: amounts.length,
      installIndex: i + 1,
      installGroupId: groupId,
    }),
  )
}

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('collapseInstallments', () => {
  it('kategori paylarını taksitler boyunca toplar (pay toplamı = indirgenmiş tutar)', () => {
    // 3 taksit: her satırın payları kendi taksit tutarına ölçekli (mutfak son pay).
    const rows = [
      tx({ amount: 1000.02, amountTry: 1000.02, isInstallment: true, installGroupId: 'g-s', installIndex: 1, installTotal: 3, categoryId: 'cat-pet',
        categorySplits: [{ categoryId: 'cat-pet', amount: 800.02 }, { categoryId: 'cat-mutfak', amount: 200 }] }),
      tx({ amount: 1000, amountTry: 1000, isInstallment: true, installGroupId: 'g-s', installIndex: 2, installTotal: 3, date: '2026-02-15', categoryId: 'cat-pet',
        categorySplits: [{ categoryId: 'cat-pet', amount: 800 }, { categoryId: 'cat-mutfak', amount: 200 }] }),
      tx({ amount: 1000, amountTry: 1000, isInstallment: true, installGroupId: 'g-s', installIndex: 3, installTotal: 3, date: '2026-03-15', categoryId: 'cat-pet',
        categorySplits: [{ categoryId: 'cat-pet', amount: 800 }, { categoryId: 'cat-mutfak', amount: 200 }] }),
    ]
    const out = collapseInstallments(rows)
    expect(out[0].amount).toBe(3000.02)
    expect(out[0].categorySplits).toEqual([
      { categoryId: 'cat-pet', amount: 2400.02 },
      { categoryId: 'cat-mutfak', amount: 600 },
    ])
    const byCat = sumExpenseByKey(out, t => t.categoryId ?? '')
    expect(byCat.get('cat-mutfak')).toBe(600)
    expect(byCat.get('cat-pet')).toBe(2400.02)
  })

  it('taksitli grubu satın alma ayına tek toplam gider olarak indirger', () => {
    const out = collapseInstallments(group())
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-15')
    expect(out[0].amount).toBe(12000)
    expect(out[0].amountTry).toBe(12000)
    expect(out[0].installTotal).toBe(3)
    expect(out[0].installIndex).toBeUndefined()
  })

  it('kuruş kalanını kaybetmez (splitMoney bölünmesi)', () => {
    const out = collapseInstallments(group('g-2', [333.34, 333.33, 333.33]))
    expect(out[0].amount).toBe(1000)
    expect(out[0].amountTry).toBe(1000)
  })

  it('satın alma satırının kimliğini ve alanlarını korur', () => {
    const rows = group()
    const out  = collapseInstallments(rows)
    expect(out[0].id).toBe(rows[0].id)
    expect(out[0].categoryId).toBe('cat-ev')
    expect(out[0].installGroupId).toBe('g-1')
  })

  it('dizi tarihe göre tersten sıralıyken de ilk taksiti baş alır', () => {
    const out = collapseInstallments([...group()].reverse())
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-15')
    expect(out[0].amount).toBe(12000)
  })

  it('taksitsiz satırları ve sırayı korur; grup yoksa aynı diziyi döner', () => {
    const plain = [tx({ date: '2026-01-01' }), tx({ date: '2026-02-01' })]
    expect(collapseInstallments(plain)).toBe(plain)

    const mixed = [plain[0], ...group(), plain[1]]
    const out   = collapseInstallments(mixed)
    expect(out.map(t => t.id)).toEqual([plain[0].id, mixed[1].id, plain[1].id])
  })

  it('birden fazla grubu birbirine karıştırmaz', () => {
    const out = collapseInstallments([...group('g-1'), ...group('g-2', [500, 500])])
    expect(out).toHaveLength(2)
    expect(out.map(t => t.amount)).toEqual([12000, 1000])
  })

  it('gelecek/onay bekleyen taksitler de toplama girer (indirgeme excludeFuture ÖNCE)', () => {
    // Bugün Ocak sonu varsayımı: Şubat/Mart taksitleri henüz işlenmemiş.
    const rows = group()
    const collapsed = collapseInstallments(rows)
    const posted    = excludeFuture(collapsed, '2026-01-31')
    expect(posted).toHaveLength(1)
    expect(calcPeriodFlow(posted, '2026-01-01', '2026-01-31').expense).toBe(12000)

    // Ham defterde aynı dönem yalnız ilk taksiti görürdü.
    expect(calcPeriodFlow(excludeFuture(rows, '2026-01-31'), '2026-01-01', '2026-01-31').expense).toBe(4000)
  })

  it('iade (negatif gider) taksiti toplamdan düşer', () => {
    const rows = [...group('g-3', [1000, 1000]), tx({
      amount: -400,
      amountTry: -400,
      date: '2026-03-01',
      isInstallment: true,
      installTotal: 2,
      installIndex: 3,
      installGroupId: 'g-3',
    })]
    expect(collapseInstallments(rows)[0].amount).toBe(1600)
  })
})

describe('rebalanceInstallmentsBelow', () => {
  it('düzenlenen taksitin altındakileri kalan tutara eşit böler, üsttekilere dokunmaz', () => {
    // 12.000 / 4 taksit; 2. taksit 3.000 → 6.000 yapıldı
    const out = rebalanceInstallmentsBelow(12000, [3000, 6000, 3000, 3000], 1)
    expect(out).toEqual([3000, 6000, 1500, 1500])
  })

  it('üstte elle girilmiş farklı tutarları korur', () => {
    const out = rebalanceInstallmentsBelow(10000, [1000, 4000, 2000, 1000, 2000], 2)
    expect(out).toEqual([1000, 4000, 2000, 1500, 1500])
  })

  it('kuruş kalanını ilk alt taksitlere verir, toplam korunur', () => {
    const out = rebalanceInstallmentsBelow(1000, [100, 0, 0, 0], 0)
    expect(out).toEqual([100, 300, 300, 300])
    const odd = rebalanceInstallmentsBelow(1000, [0.01, 0, 0, 0], 0)
    expect(odd).toEqual([0.01, 333.33, 333.33, 333.33])
    expect(Math.round(odd.reduce((a, b) => a + b, 0) * 100)).toBe(100000)
  })

  it('son taksit düzenlenirse diziyi aynen döner', () => {
    const rows = [500, 500, 700]
    expect(rebalanceInstallmentsBelow(1500, rows, 2)).toBe(rows)
  })

  it('üsttekiler toplamı aşarsa alttakiler 0 olur (negatif taksit yok)', () => {
    expect(rebalanceInstallmentsBelow(1000, [800, 400, 100], 1)).toEqual([800, 400, 0])
  })
})

describe('findInstallmentRoundingFixes', () => {
  const mk = (groupId: string, amounts: number[], over: Partial<Transaction> = {}) =>
    amounts.map((amount, i) => tx({
      amount, amountTry: amount, isInstallment: true, installGroupId: groupId,
      installIndex: i + 1, installTotal: amounts.length, description: 'Kedi Tuvaleti', ...over,
    }))

  it('eski yuvarlamayla bölünmüş grubu banka kuralına çevirir', () => {
    // 15.413 / 9 eski: 5×1.712,56 + 4×1.712,55 → banka: 1.712,60 + 8×1.712,55
    const rows = mk('kedi', [...Array(5).fill(1712.56), ...Array(4).fill(1712.55)])
    const [fix] = findInstallmentRoundingFixes(rows)
    expect(fix.total).toBe(15413)
    expect(fix.changes.map(c => [c.tx.installIndex, c.amount])).toEqual([
      [1, 1712.60], [2, 1712.55], [3, 1712.55], [4, 1712.55], [5, 1712.55],
    ])
  })

  it('zaten banka kuralıyla bölünmüş, elle girilmiş ya da tam bölünen gruplara dokunmaz', () => {
    const bank   = mk('bank', [1712.60, ...Array(8).fill(1712.55)])
    const manual = mk('manual', [1000, 500, 500.01])
    const even   = mk('even', [4000, 4000, 4000])
    expect(findInstallmentRoundingFixes([...bank, ...manual, ...even])).toEqual([])
  })

  it('eksik satırlı veya silinmiş satırlı grupları atlar', () => {
    const legacy = [333.34, 333.34, 333.33]   // 1000,01 / 3 eski bölüşüm — tam grupsa düzeltilirdi
    expect(findInstallmentRoundingFixes(mk('full', legacy))).toHaveLength(1)
    const partial = mk('p', legacy).slice(0, 2)
    const withDeleted = mk('d', legacy)
    withDeleted[2] = { ...withDeleted[2], deleted_at: '2026-01-01T00:00:00Z' }
    expect(findInstallmentRoundingFixes([...partial, ...withDeleted])).toEqual([])
  })
})

/* ── Taksitli + bölünmüş alışveriş: kategori payı onarımı ──────────────── */

/** ESKİ kayıt yolu: paylar her taksitte ayrı yuvarlanır (rescaleSplits). */
function legacySplitGroup(groupId: string, total: number, n: number, splits: { categoryId: string; amount: number }[]): Transaction[] {
  const amounts = splitInstallments(total, n)
  return amounts.map((amount, i) => tx({
    amount, amountTry: amount, date: `2026-${String((i % 12) + 1).padStart(2, '0')}-05`,
    description: 'Kedi Tuvaleti + Others', categoryId: splits[0].categoryId,
    categorySplits: rescaleSplits(splits, amount),
    isInstallment: true, installTotal: n, installIndex: i + 1, installGroupId: groupId,
  }))
}
const k = (n: number) => Math.round(n * 100)
function categorySums(rows: Transaction[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) for (const s of r.categorySplits ?? []) m.set(s.categoryId, (m.get(s.categoryId) ?? 0) + k(s.amount))
  return m
}
function applyFix(rows: Transaction[]): Transaction[] {
  const { fixes } = findInstallmentSplitFixes(rows)
  const byId = new Map(fixes.flatMap(f => f.changes.map(c => [c.tx.id, c.splits] as const)))
  return rows.map(r => byId.has(r.id) ? { ...r, categorySplits: byId.get(r.id) } : r)
}

describe('findInstallmentSplitFixes', () => {
  const userSplits = [
    { categoryId: 'pets', amount: 9000 }, { categoryId: 'ev', amount: 2514.5 },
    { categoryId: 'temizlik', amount: 1699.5 }, { categoryId: 'mutfak', amount: 2199 },
  ]

  it('eski yuvarlamayla kaymış paylari girilen tutarlara geri getirir (15.413₺ / 9 taksit)', () => {
    const rows = legacySplitGroup('g-k', 15413, 9, userSplits)
    const before = categorySums(rows)
    expect(userSplits.some(s => before.get(s.categoryId) !== k(s.amount))).toBe(true)   // kayma var

    const { fixes, unresolved } = findInstallmentSplitFixes(rows)
    expect(unresolved).toEqual([])
    expect(fixes).toHaveLength(1)
    const after = categorySums(applyFix(rows))
    for (const s of userSplits) expect(after.get(s.categoryId)).toBe(k(s.amount))
    // Satır toplamları taksit tutarına eşit kalır.
    for (const r of applyFix(rows)) expect(r.categorySplits!.reduce((a, s) => a + k(s.amount), 0)).toBe(k(r.amount))
  })

  it('onarılmış ya da yeni yolla kaydedilmiş grubu tekrar önermez', () => {
    expect(findInstallmentSplitFixes(applyFix(legacySplitGroup('g-k', 15413, 9, userSplits))).fixes).toEqual([])
    const amounts = splitInstallments(15413, 9)
    const exact = splitsForInstallments(userSplits, amounts)
    const rows = amounts.map((amount, i) => tx({
      amount, categorySplits: exact[i], isInstallment: true, installTotal: 9, installIndex: i + 1, installGroupId: 'g-n',
    }))
    expect(findInstallmentSplitFixes(rows)).toEqual({ fixes: [], unresolved: [] })
  })

  it('sonradan tek taksiti elle değiştirilmiş grubu tahmin etmez, unresolved döner', () => {
    const rows = legacySplitGroup('g-t', 15413, 9, userSplits)
    rows[3] = { ...rows[3], categorySplits: [
      { categoryId: 'pets', amount: 100 }, { categoryId: 'ev', amount: 100 },
      { categoryId: 'temizlik', amount: 100 }, { categoryId: 'mutfak', amount: k(rows[3].amount) / 100 - 300 },
    ] }
    const { fixes, unresolved } = findInstallmentSplitFixes(rows)
    expect(fixes).toEqual([])
    expect(unresolved.map(u => u.groupId)).toEqual(['g-t'])
  })

  it('tam liralık paylar her taksit sayısında birebir geri çözülür (özellik testi)', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let checked = 0
    for (let iter = 0; iter < 400; iter++) {
      const n = 2 + rnd(23)
      const cats = 2 + rnd(4)
      const parts = Array.from({ length: cats }, () => 1 + rnd(5000))
      const splits = parts.map((p, j) => ({ categoryId: `c${j}`, amount: p }))
      const total = parts.reduce((a, b) => a + b, 0)
      const rows = legacySplitGroup(`g${iter}`, total, n, splits)
      const fixed = applyFix(rows)
      const sums = categorySums(fixed)
      for (const s of splits) expect(sums.get(s.categoryId), `n=${n} total=${total} parts=${parts}`).toBe(k(s.amount))
      checked++
    }
    expect(checked).toBe(400)
  })

  it('yeni yolla kaydedilmiş kasıtlı kuruşlu payı yuvarlamaz', () => {
    const splits = [{ categoryId: 'a', amount: 1000.37 }, { categoryId: 'b', amount: 499.63 }]
    const amounts = splitInstallments(1500, 6)
    const exact = splitsForInstallments(splits, amounts)
    const rows = amounts.map((amount, i) => tx({
      amount, categorySplits: exact[i], isInstallment: true, installTotal: 6, installIndex: i + 1, installGroupId: 'g-q',
    }))
    expect(findInstallmentSplitFixes(rows).fixes).toEqual([])
  })
})
