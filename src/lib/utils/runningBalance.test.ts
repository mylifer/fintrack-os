import { describe, it, expect, beforeAll } from 'vitest'
import { computeRunningBalances } from './runningBalance'
import { computeTransactionEffect } from './calculations'
import { setBaseRates } from './fx'
import type { Account, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   runningBalance — işlem-sonrası ("güncel") bakiye haritası

   Bu modülün TEK varlık sebebi tutarlılık: işlem listesinin tablo görünümü ile
   gün kartı görünümü aynı satır için aynı sayıyı göstersin. Dolayısıyla asıl
   sözleşme "kendi içinde doğru" değil, "computeTransactionEffect ile AYNI
   sonucu üretmek" — hesap başlığındaki bakiye oradan geliyor. Son test tam da
   bu değişmezi zorluyor.
──────────────────────────────────────────────────────────────────────── */

function acc(id: string, initialBalance: number, currency: Account['currency'] = 'TRY'): Account {
  return {
    id, name: id, type: 'checking', currency, balance: 0, initialBalance,
    color: '#000', isArchived: false, createdAt: '2026-01-01',
  }
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'amount' | 'date' | 'accountId'>): Transaction {
  return {
    currency: 'TRY', description: p.id, isInstallment: false,
    createdAt: p.date, updatedAt: p.date, ...p,
  }
}

const byId = (...accounts: Account[]) => new Map(accounts.map(a => [a.id, a]))

describe('computeRunningBalances — tek hesap', () => {
  it('gelir ekler, gider düşer ve her satır için o satırdan SONRAKİ bakiyeyi yazar', () => {
    const a = acc('a', 1_000)
    const ledger = [
      tx({ id: 't1', type: 'income',  amount: 500, date: '2026-03-01', accountId: 'a' }),
      tx({ id: 't2', type: 'expense', amount: 200, date: '2026-03-02', accountId: 'a' }),
      tx({ id: 't3', type: 'expense', amount: 50,  date: '2026-03-03', accountId: 'a' }),
    ]
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.get('t1')).toBe(1_500)
    expect(map.get('t2')).toBe(1_300)
    expect(map.get('t3')).toBe(1_250)
  })

  it('kuruş toplaması sürüklenmez (minor birim yürüyüşü)', () => {
    const a = acc('a', 0)
    const ledger = Array.from({ length: 3 }, (_, i) =>
      tx({ id: `t${i}`, type: 'income', amount: 0.1, date: `2026-03-0${i + 1}`, accountId: 'a' }),
    )
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.get('t2')).toBe(0.3)   // 0.1+0.1+0.1 — float olsaydı 0.30000000000000004
  })

  it('negatif tutarlı iade satırı gideri netler', () => {
    const a = acc('a', 1_000)
    const ledger = [
      tx({ id: 't1', type: 'expense', amount: 250,  date: '2026-03-01', accountId: 'a' }),
      tx({ id: 't2', type: 'expense', amount: -100, date: '2026-03-02', accountId: 'a' }),
    ]
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.get('t1')).toBe(750)
    expect(map.get('t2')).toBe(850)
  })
})

describe('computeRunningBalances — onay kapısı ve sıralama', () => {
  it("'pending' satır bakiyeye hiç işlenmez ve kendi bakiye alanı boş kalır", () => {
    const a = acc('a', 1_000)
    const ledger = [
      tx({ id: 't1', type: 'expense', amount: 100, date: '2026-03-01', accountId: 'a' }),
      tx({ id: 'p1', type: 'expense', amount: 999, date: '2026-03-02', accountId: 'a', approvalStatus: 'pending' }),
      tx({ id: 't2', type: 'expense', amount: 100, date: '2026-03-03', accountId: 'a' }),
    ]
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.has('p1')).toBe(false)
    expect(map.get('t2')).toBe(800)   // 999 hiç düşülmedi
  })

  it("'pending' damgalı taksit satırı onay beklemeden bakiyeye işlenir", () => {
    const a = acc('a', 1_000)
    const ledger = [
      tx({ id: 'i2', type: 'expense', amount: 200, date: '2026-03-02', accountId: 'a', approvalStatus: 'pending', isInstallment: true, installGroupId: 'G' }),
    ]
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.get('i2')).toBe(800)
  })

  it('defter kronolojik yürür; girdi sırası sonucu değiştirmez', () => {
    const a = acc('a', 0)
    const early = tx({ id: 'early', type: 'income',  amount: 100, date: '2026-03-01', accountId: 'a' })
    const late  = tx({ id: 'late',  type: 'expense', amount: 40,  date: '2026-03-05', accountId: 'a' })
    const shuffled = computeRunningBalances([late, early], ['a'], byId(a))
    const ordered  = computeRunningBalances([early, late], ['a'], byId(a))
    expect(shuffled.get('early')).toBe(100)
    expect(shuffled.get('late')).toBe(60)
    expect([...shuffled.entries()]).toEqual([...ordered.entries()])
  })

  it('aynı gün içinde createdAt sırayı belirler', () => {
    const a = acc('a', 0)
    const ledger = [
      tx({ id: 'second', type: 'expense', amount: 30, date: '2026-03-01', accountId: 'a', createdAt: '2026-03-01T12:00:00Z' }),
      tx({ id: 'first',  type: 'income',  amount: 100, date: '2026-03-01', accountId: 'a', createdAt: '2026-03-01T09:00:00Z' }),
    ]
    const map = computeRunningBalances(ledger, ['a'], byId(a))
    expect(map.get('first')).toBe(100)
    expect(map.get('second')).toBe(70)
  })

  it('izlenmeyen hesabın satırları haritaya girmez', () => {
    const a = acc('a', 0)
    const ledger = [tx({ id: 'other', type: 'income', amount: 100, date: '2026-03-01', accountId: 'zzz' })]
    expect(computeRunningBalances(ledger, ['a'], byId(a)).size).toBe(0)
  })

  it('hiçbir izlenen hesap çözülemezse boş harita döner', () => {
    const ledger = [tx({ id: 't1', type: 'income', amount: 100, date: '2026-03-01', accountId: 'a' })]
    expect(computeRunningBalances(ledger, ['yok'], byId(acc('a', 0))).size).toBe(0)
  })
})

describe('computeRunningBalances — transfer', () => {
  it('aynı para biriminde transfer kaynaktan düşer, hedefe ekler', () => {
    const a = acc('a', 1_000)
    const b = acc('b', 100)
    const ledger = [tx({ id: 't1', type: 'transfer', amount: 400, date: '2026-03-01', accountId: 'a', toAccountId: 'b' })]

    // accountIds artan öncelik sırasında: SON gelen hesabın bakiyesi yazılır.
    expect(computeRunningBalances(ledger, ['b', 'a'], byId(a, b)).get('t1')).toBe(600)  // a kazanır
    expect(computeRunningBalances(ledger, ['a', 'b'], byId(a, b)).get('t1')).toBe(500)  // b kazanır
  })

  it('yalnızca kaynak izleniyorsa yalnızca çıkış işlenir', () => {
    const a = acc('a', 1_000)
    const ledger = [tx({ id: 't1', type: 'transfer', amount: 400, date: '2026-03-01', accountId: 'a', toAccountId: 'b' })]
    expect(computeRunningBalances(ledger, ['a'], byId(a)).get('t1')).toBe(600)
  })

  it('hedefsiz transfer (borç ödemesi) yalnızca kaynaktan düşer', () => {
    const a = acc('a', 1_000)
    const ledger = [tx({ id: 'pay', type: 'transfer', amount: 250, date: '2026-03-01', accountId: 'a', debtId: 'd1' })]
    expect(computeRunningBalances(ledger, ['a'], byId(a)).get('pay')).toBe(750)
  })
})

/* ── Çapraz kur transferi: tek doğruluk kaynağıyla uyum ────────────────────
   Denetim bulgusu #13 (düzeltildi). computeRunningBalances eskiden para
   birimini hiç sorgulamıyor ve gelen bacağı ham `tx.amount` ile ekliyordu;
   computeTransactionEffect ise hedefin para birimine çeviriyor
   (calculations.ts:44-49). Sonuç: hesap detayında BAŞLIKTAKİ bakiye ile
   LİSTEDEKİ bakiye kolonu kalıcı olarak farklıydı (10.000 ₺'lik transfer USD
   defterine 10.000 $ olarak giriyordu).

   Aşağıdaki test iki yolun AYNI sayıyı üretmesini zorluyor — regresyon kapısı.
──────────────────────────────────────────────────────────────────────── */
describe('çapraz kur transferi — düzeltilen hata #13', () => {
  beforeAll(() => {
    setBaseRates({ usdTry: 34.5, eurTry: 37, gbpTry: 43 } as never)
  })

  it('gelen bacak hedef hesabın para birimine çevrilir (computeTransactionEffect ile aynı sayı)', () => {
    const tryAcc = acc('try', 0, 'TRY')
    const usdAcc = acc('usd', 0, 'USD')
    const transfer = tx({
      id: 'x', type: 'transfer', amount: 10_000, currency: 'TRY',
      date: '2026-03-01', accountId: 'try', toAccountId: 'usd', amountTry: 10_000,
    })

    const listBalance = computeRunningBalances([transfer], ['try', 'usd'], byId(tryAcc, usdAcc)).get('x')
    const headerBalance = usdAcc.initialBalance + computeTransactionEffect(usdAcc, [transfer])

    expect(headerBalance).toBeCloseTo(289.86, 2)   // 10.000 ₺ / 34,5 — bu taraf doğru
    expect(listBalance).toBe(headerBalance)        // düzeltme öncesi 10.000 (çevrilmemiş ham tutar) dönüyordu
  })

  it('aynı para biriminde iki yol zaten uyumlu (regresyon koruması)', () => {
    const a = acc('a', 0, 'TRY')
    const b = acc('b', 0, 'TRY')
    const transfer = tx({ id: 'x', type: 'transfer', amount: 400, date: '2026-03-01', accountId: 'a', toAccountId: 'b' })

    const listBalance = computeRunningBalances([transfer], ['a', 'b'], byId(a, b)).get('x')
    expect(listBalance).toBe(b.initialBalance + computeTransactionEffect(b, [transfer]))
  })
})
