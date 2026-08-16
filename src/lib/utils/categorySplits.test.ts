import { describe, it, expect } from 'vitest'
import {
  equalSplit, splitsMatchAmount, splitsAreValid, setSplitAmount, distributeSplits, unpinSplits,
  rescaleSplits, primarySplitCategoryId, txCategorySlices, expandByCategory, txHasCategory,
  txCategoryIds, hasDuplicateCategory, type DraftSplit,
} from './categorySplits'
import { sumMoney } from './money'
import type { Transaction } from '@/types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1', type: 'expense', amount: 1000, currency: 'TRY', date: '2026-08-16',
  accountId: 'a1', description: 'Market', isInstallment: false,
  createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
})

describe('equalSplit', () => {
  it('bölünemeyen tutarda kuruş kalanını ilk paylara dağıtır ve toplamı korur', () => {
    const s = equalSplit(1000, ['a', 'b', 'c'])
    expect(s.map(x => x.amount)).toEqual([333.34, 333.33, 333.33])
    expect(sumMoney(s.map(x => x.amount))).toBe(1000)
  })

  it('float toplamada kayma yaratmaz (0.1 + 0.2 vakası)', () => {
    const s = equalSplit(0.3, ['a', 'b'])
    expect(sumMoney(s.map(x => x.amount))).toBe(0.3)
  })
})

describe('splitsMatchAmount / splitsAreValid', () => {
  it('bir kuruş sapmayı yakalar', () => {
    expect(splitsMatchAmount([{ categoryId: 'a', amount: 500 }, { categoryId: 'b', amount: 499.99 }], 1000)).toBe(false)
  })

  it('tek pay geçerli bir bölme değildir', () => {
    expect(splitsAreValid([{ categoryId: 'a', amount: 1000 }], 1000)).toBe(false)
  })

  it('kategorisi boş pay geçersizdir', () => {
    expect(splitsAreValid([{ categoryId: 'a', amount: 500 }, { categoryId: '', amount: 500 }], 1000)).toBe(false)
  })

  it('toplamı tutan çok paylı bölme geçerlidir', () => {
    expect(splitsAreValid(equalSplit(1000, ['a', 'b', 'c']), 1000)).toBe(true)
  })

  it('aynı kategori iki payda geçemez', () => {
    expect(splitsAreValid([
      { categoryId: 'a', amount: 500 },
      { categoryId: 'a', amount: 500 },
    ], 1000)).toBe(false)
  })
})

/* Aynı kategori bir işlemde tek bir paya girebilir. Kural kategorinin
   KENDİSİNE özeldir: üst kategori bir payda kullanılsa da alt kategorileri
   (ve tersi) ayrı birer pay olabilir — bunlar farklı kategorilerdir. */
describe('hasDuplicateCategory', () => {
  it('birebir tekrarı yakalar', () => {
    expect(hasDuplicateCategory([
      { categoryId: 'market', amount: 500 },
      { categoryId: 'market', amount: 500 },
    ])).toBe(true)
  })

  it('üst kategori ile alt kategorisi birlikte kullanılabilir', () => {
    expect(hasDuplicateCategory([
      { categoryId: 'ev',          amount: 600 },   // üst
      { categoryId: 'ev-elektrik', amount: 400 },   // alt
    ])).toBe(false)
  })

  it('farklı kategoriler tekrar sayılmaz', () => {
    expect(hasDuplicateCategory(equalSplit(900, ['a', 'b', 'c']))).toBe(false)
  })
})

/* Elle girilen pay SABİTLENİR: sonraki girişler onu oynatmaz, kalanı otomatik
   pay (pratikte sonuncusu) yutar. Sabitler kalana sığmazsa SONDAN serbest
   bırakılır — en eski girişler korunur. */
describe('setSplitAmount — sabitlenen paylar', () => {
  const amounts = (s: DraftSplit[]) => s.map(x => x.amount)
  const base = equalSplit(1000, ['a', 'b', 'c']) as DraftSplit[]

  it('bir payı yazınca kalan otomatik paylara eşit dağıtılır', () => {
    const next = setSplitAmount(base, 0, 700, 1000)
    expect(amounts(next)).toEqual([700, 150, 150])
    expect(sumMoney(amounts(next))).toBe(1000)
  })

  it('ikinci giriş BİRİNCİYİ değiştirmez, kalanı son pay yutar', () => {
    const first  = setSplitAmount(base, 0, 700, 1000)
    const second = setSplitAmount(first, 1, 200, 1000)
    expect(second[0].amount).toBe(700)     // önceki giriş korundu
    expect(second[1].amount).toBe(200)
    expect(second[2].amount).toBe(100)     // kalan
    expect(sumMoney(amounts(second))).toBe(1000)
  })

  it('iki kategoride: ilkini yazmak ikincisini kalana çevirir', () => {
    const two = equalSplit(1250, ['a', 'b']) as DraftSplit[]
    const next = setSplitAmount(two, 0, 900, 1250)
    expect(amounts(next)).toEqual([900, 350])
  })

  it('üçüncü giriş de ilk ikisini korur (kalan yettiği sürece)', () => {
    const s1 = setSplitAmount(base, 0, 500, 1000)   // a sabit 500
    const s2 = setSplitAmount(s1,  1, 300, 1000)    // b sabit 300 → c otomatik 200
    expect(amounts(s2)).toEqual([500, 300, 200])
  })

  it('kalandan büyük giriş sabitleri SONDAN serbest bırakır, toplam yine tutar', () => {
    const s1 = setSplitAmount(base, 0, 500, 1000)
    const s2 = setSplitAmount(s1,  1, 300, 1000)    // a=500, b=300, c=200
    const s3 = setSplitAmount(s2,  2, 900, 1000)    // c için yalnız 200 boştu
    expect(s3[2].amount).toBe(900)                  // yazılan tutar uygulanır
    expect(s3[0].amount + s3[1].amount).toBe(100)   // sığmayan sabitler bırakıldı
    expect(sumMoney(amounts(s3))).toBe(1000)
  })

  it('tutarın üstüne çıkan girişi kırpar, diğer paylar sıfırlanır', () => {
    const next = setSplitAmount(base, 1, 99999, 1000)
    expect(next[1].amount).toBe(1000)
    expect(sumMoney(amounts(next))).toBe(1000)
  })

  it('negatif tutarda (iade) işareti korur', () => {
    const neg = equalSplit(-1000, ['a', 'b']) as DraftSplit[]
    const next = setSplitAmount(neg, 0, -800, -1000)
    expect(amounts(next)).toEqual([-800, -200])
    expect(sumMoney(amounts(next))).toBe(-1000)
  })
})

describe('distributeSplits — tutar/pay değişimi', () => {
  const amounts = (s: DraftSplit[]) => s.map(x => x.amount)

  it('toplam artınca sabit pay aynen kalır, farkı otomatik pay yutar', () => {
    const pinned = setSplitAmount(equalSplit(1000, ['a', 'b']) as DraftSplit[], 0, 700, 1000)
    const next = distributeSplits(pinned, 1500)
    expect(next[0].amount).toBe(700)
    expect(next[1].amount).toBe(800)
    expect(sumMoney(amounts(next))).toBe(1500)
  })

  it('toplam sabitlerin altına düşerse SONDAN serbest bırakır, ilk giriş kalır', () => {
    let s = setSplitAmount(equalSplit(1000, ['a', 'b', 'c']) as DraftSplit[], 0, 300, 1000)
    s = setSplitAmount(s, 1, 300, 1000)              // a=300, b=300, c=400
    const next = distributeSplits(s, 500)            // 600 sabit > 500 → b bırakılır
    expect(next[0].amount).toBe(300)                 // en eski giriş korundu
    expect(sumMoney(amounts(next))).toBe(500)
  })

  it('tek bir sabit bile toplamı aşıyorsa paylar baştan eşit bölünür', () => {
    const s = setSplitAmount(equalSplit(1000, ['a', 'b']) as DraftSplit[], 0, 900, 1000)
    const next = distributeSplits(s, 400)            // 900 hiçbir şekilde sığmaz
    expect(sumMoney(amounts(next))).toBe(400)
    expect(next.every(x => x.amount > 0)).toBe(true)
  })

  it('yeni pay eklemek elle girilen tutarlara dokunmaz', () => {
    const pinned = setSplitAmount(equalSplit(1000, ['a', 'b']) as DraftSplit[], 0, 700, 1000)
    const next = distributeSplits([...pinned, { categoryId: 'c', amount: 0 }], 1000)
    expect(next[0].amount).toBe(700)
    expect(next[1].amount + next[2].amount).toBe(300)
    expect(sumMoney(amounts(next))).toBe(1000)
  })

  it('hepsi sabitken toplam değişirse son pay kalanı yutar', () => {
    let s = setSplitAmount(equalSplit(1000, ['a', 'b']) as DraftSplit[], 0, 600, 1000)
    s = setSplitAmount(s, 1, 400, 1000)
    const next = distributeSplits(s, 1200)
    expect(next[0].amount).toBe(600)
    expect(next[1].amount).toBe(600)
    expect(sumMoney(amounts(next))).toBe(1200)
  })
})

describe('unpinSplits', () => {
  it('sabitleri kaldırır ve eşit bölüşe döner', () => {
    const pinned = setSplitAmount(equalSplit(1000, ['a', 'b', 'c']) as DraftSplit[], 0, 900, 1000)
    const next = unpinSplits(pinned, 1000)
    expect(next.map(s => s.amount)).toEqual([333.34, 333.33, 333.33])
    expect(next.every(s => !s.pinned)).toBe(true)
  })
})

describe('rescaleSplits', () => {
  it('tutar değişince oranları korur ve yeni toplama tam oturur', () => {
    const s = rescaleSplits([{ categoryId: 'a', amount: 750 }, { categoryId: 'b', amount: 250 }], 400)
    expect(s.map(x => x.amount)).toEqual([300, 100])
    expect(sumMoney(s.map(x => x.amount))).toBe(400)
  })

  it('yuvarlanamayan oranda bile toplam TAM tutar', () => {
    const s = rescaleSplits(equalSplit(1000, ['a', 'b', 'c']), 100.01)
    expect(sumMoney(s.map(x => x.amount))).toBe(100.01)
  })

  it('tüm paylar sıfırken eşit bölüşe düşer', () => {
    const s = rescaleSplits([{ categoryId: 'a', amount: 0 }, { categoryId: 'b', amount: 0 }], 50)
    expect(s.map(x => x.amount)).toEqual([25, 25])
  })
})

describe('primarySplitCategoryId', () => {
  it('en büyük payın kategorisini verir', () => {
    expect(primarySplitCategoryId([
      { categoryId: 'a', amount: 300 },
      { categoryId: 'b', amount: 700 },
    ])).toBe('b')
  })

  it('iade (negatif) paylarda da büyüklüğe bakar', () => {
    expect(primarySplitCategoryId([
      { categoryId: 'a', amount: -300 },
      { categoryId: 'b', amount: -700 },
    ])).toBe('b')
  })
})

describe('txCategorySlices', () => {
  it('bölünmemiş işlemi aynen (aynı referansla) geçirir', () => {
    const t = tx()
    expect(txCategorySlices(t)[0]).toBe(t)
  })

  it('payları ayrı satırlara açar ve amountTry snapshotını oranla böler', () => {
    const t = tx({
      amount: 1000, amountTry: 1000,
      categorySplits: [{ categoryId: 'a', amount: 750 }, { categoryId: 'b', amount: 250 }],
    })
    const slices = txCategorySlices(t)
    expect(slices.map(s => s.categoryId)).toEqual(['a', 'b'])
    expect(slices.map(s => s.amount)).toEqual([750, 250])
    expect(slices.map(s => s.amountTry)).toEqual([750, 250])
    expect(sumMoney(slices.map(s => s.amountTry!))).toBe(t.amountTry)
  })

  it('yabancı para: TRY snapshotı kuruşu kuruşuna korunur', () => {
    const t = tx({
      amount: 100, currency: 'USD', amountTry: 3333.33,
      categorySplits: equalSplit(100, ['a', 'b', 'c']),
    })
    const slices = txCategorySlices(t)
    expect(sumMoney(slices.map(s => s.amountTry!))).toBe(3333.33)
  })

  it('snapshot yoksa dilimlere de yazılmaz (canlı kur çevirisi korunur)', () => {
    const t = tx({ amountTry: undefined, categorySplits: equalSplit(1000, ['a', 'b']) })
    expect(txCategorySlices(t).every(s => s.amountTry === undefined)).toBe(true)
  })

  it('dilimler yeniden açılmasın diye categorySplits taşımaz', () => {
    const t = tx({ categorySplits: equalSplit(1000, ['a', 'b']) })
    expect(txCategorySlices(t).every(s => s.categorySplits === undefined)).toBe(true)
  })
})

describe('expandByCategory', () => {
  it('bölünmüş satır yoksa diziyi aynen döndürür', () => {
    const list = [tx(), tx({ id: 't2' })]
    expect(expandByCategory(list)).toBe(list)
  })

  it('toplam tutarı değiştirmez, yalnızca kategoriye dağıtır', () => {
    const list = [
      tx({ id: 't1', amount: 1000, categorySplits: equalSplit(1000, ['a', 'b']) }),
      tx({ id: 't2', amount: 500, categoryId: 'c' }),
    ]
    const out = expandByCategory(list)
    expect(out).toHaveLength(3)
    expect(sumMoney(out.map(t => t.amount))).toBe(1500)
  })
})

describe('txHasCategory / txCategoryIds', () => {
  it('paylardan biri eşleşirse işlem o kategoriye aittir', () => {
    const t = tx({ categoryId: 'a', categorySplits: [{ categoryId: 'a', amount: 600 }, { categoryId: 'b', amount: 400 }] })
    expect(txHasCategory(t, 'b')).toBe(true)
    expect(txHasCategory(t, 'z')).toBe(false)
    expect(txCategoryIds(t)).toEqual(['a', 'b'])
  })

  it('bölünmemiş işlemde tek kategoriye düşer', () => {
    expect(txCategoryIds(tx({ categoryId: 'a' }))).toEqual(['a'])
    expect(txCategoryIds(tx({ categoryId: undefined }))).toEqual([])
  })
})
