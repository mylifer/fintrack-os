import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InvestmentTransaction, Transaction } from '@/types'
import { setBaseRates } from '@/lib/utils/fx'

/* ────────────────────────────────────────────────────────────────────────
   investment.store — bağlı defter satırlarının para birimi

   Yatırım tutarları TL'dir. Alım/satışa seçilen hesap USD/EUR olabilir; bağlı
   defter satırı TL tutarla ve 'TRY' etiketiyle yazılınca bakiye hesabı
   (computeTransactionEffect) o tutarı hesabın kendi birimi sayıyordu:
   10.000 ₺'lik alım USD hesabından 10.000 $ düşüyordu. Satır artık hesabın
   para biriminde yazılır; kur yoksa hiçbir şey yazılmadan hata verilir.
──────────────────────────────────────────────────────────────────────── */

const added: Transaction[] = []
const upserts: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async (_t: string, e: Record<string, unknown>) => { upserts.push(e) },
  localPatch: async () => {},
  softDelete: async () => {},
  reconcilingPull: async () => [],
}))
vi.mock('./transactions.store', () => ({
  useTransactionStore: {
    getState: () => ({
      transactions: [],
      add: async (tx: Transaction) => { added.push(tx) },
      remove: async () => {},
    }),
  },
}))
vi.mock('./accounts.store', () => ({
  useAccountStore: {
    getState: () => ({
      accounts: [
        { id: 'try-acc', currency: 'TRY' },
        { id: 'usd-acc', currency: 'USD' },
      ],
    }),
  },
}))
vi.mock('./categories.store', () => ({ useCategoryStore: { getState: () => ({ categories: [] }) } }))
vi.mock('./settings.store', () => ({ getFundTaxConfig: () => ({ enabled: false, defaultRate: 0, rates: {} }) }))

const RATES = {
  usdTry: 40, eurTry: 45, gbpTry: 50,
  goldGramTry: 0, goldQuarterTry: 0, goldHalfTry: 0, goldFullTry: 0, bilezikGramTry: 0, updatedAt: 0,
}

function buy(accountId: string): InvestmentTransaction {
  return {
    id: crypto.randomUUID(), type: 'buy', asset: 'GOLD_GRAM', quantity: 2, pricePerUnit: 5000,
    sourceAccountId: accountId, date: '2026-10-01', createdAt: '2026-10-01T10:00:00.000Z',
  } as InvestmentTransaction
}

beforeEach(() => {
  added.length = 0
  upserts.length = 0
})

describe('bağlı defter satırı — hesabın para birimi', () => {
  it('TL hesaptan alım TL tutarla yazılır', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    await useInvestmentStore.getState().addTransaction(buy('try-acc'))
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ amount: 10_000, currency: 'TRY', accountId: 'try-acc' })
  })

  it('USD hesaptan alım USD karşılığıyla yazılır (10.000 ₺ → 250 $)', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    await useInvestmentStore.getState().addTransaction(buy('usd-acc'))
    expect(added[0]).toMatchObject({ amount: 250, currency: 'USD', accountId: 'usd-acc' })
  })

  it('USD hesaba satışta gelir, kâr satırı da USD yazılır', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    const b = buy('try-acc')
    useInvestmentStore.setState({ transactions: [b] })
    await useInvestmentStore.getState().addTransaction({
      id: 'sell-1', type: 'sell', asset: 'GOLD_GRAM', quantity: 2, pricePerUnit: 6000,
      targetAccountId: 'usd-acc', date: '2026-10-05', createdAt: '2026-10-05T10:00:00.000Z',
    } as InvestmentTransaction)
    // Satış: maliyet 10.000 ₺ (anapara) + 2.000 ₺ kâr
    expect(added.map(t => [t.currency, t.amount, t.type])).toEqual([
      ['USD', 250, 'income'],
      ['USD', 50, 'income'],
    ])
  })

  it('kur yoksa yabancı para hesabına hiçbir şey yazılmaz, hata verilir', async () => {
    vi.resetModules()   // fx modülünün kurlarını sıfırla (setBaseRates(null) erken döner)
    const { useInvestmentStore } = await import('./investment.store')
    await expect(useInvestmentStore.getState().addTransaction(buy('usd-acc'))).rejects.toThrow(/kuru/)
    expect(added).toHaveLength(0)
    expect(upserts).toHaveLength(0)
  })
})

/* Denetim #7 — satışın maliyet bazı SATIŞ TARİHİNDEKİ ortalama maliyettir.
   Eskiden computeHoldings(...) ile BUGÜNKÜ ortalama kullanılıyordu; tamamen
   satılmış varlıkta holding olmadığından maliyet 0 çıkıyordu. */
describe('geriye tarihli satış — as-of maliyet bazı (#7)', () => {
  const inv = (o: Partial<InvestmentTransaction>): InvestmentTransaction => ({
    id: crypto.randomUUID(), type: 'buy', asset: 'GOLD_GRAM', quantity: 100, pricePerUnit: 2000,
    date: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z', ...o,
  } as InvestmentTransaction)

  it('Şubat tarihli satış Mart alımının maliyetini görmez', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    useInvestmentStore.setState({ transactions: [
      inv({ pricePerUnit: 2000, date: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z' }),
      inv({ pricePerUnit: 4000, date: '2026-03-10', createdAt: '2026-03-10T10:00:00.000Z' }),
    ] })
    // Bugünkü ortalama 3.000; Şubat'taki 2.000
    await useInvestmentStore.getState().addTransaction(inv({
      type: 'sell', quantity: 50, pricePerUnit: 3000, targetAccountId: 'try-acc',
      date: '2026-02-10', createdAt: '2026-04-01T10:00:00.000Z',
    }))
    expect(added.map(t => [t.type, t.amount])).toEqual([
      ['income', 100_000],   // anapara: 50 × 2.000
      ['income', 50_000],    // kâr: 150.000 − 100.000
    ])
  })

  it('bugün tamamen satılmış varlığa geriye tarihli satış maliyetsiz kalmaz', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    useInvestmentStore.setState({ transactions: [
      inv({ quantity: 100, pricePerUnit: 100, date: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z' }),
      inv({ type: 'sell', quantity: 100, pricePerUnit: 150, date: '2026-06-10', createdAt: '2026-06-10T10:00:00.000Z' }),
    ] })
    await useInvestmentStore.getState().addTransaction(inv({
      type: 'sell', quantity: 10, pricePerUnit: 1000, targetAccountId: 'try-acc',
      date: '2026-05-10', createdAt: '2026-07-01T10:00:00.000Z',
    }))
    expect(added.map(t => [t.type, t.amount])).toEqual([
      ['income', 1_000],     // anapara: 10 × 100 (Mayıs ortalaması)
      ['income', 9_000],     // kâr — eskiden 10.000'in tamamı maliyetsiz yazılıyordu
    ])
  })

  it('düzenlemede satış tarihi geriye çekilince maliyet yeni tarihe göre', async () => {
    setBaseRates(RATES as never)
    const { useInvestmentStore } = await import('./investment.store')
    const sell = inv({
      id: 'sell-edit', type: 'sell', quantity: 50, pricePerUnit: 3000, targetAccountId: 'try-acc',
      date: '2026-04-10', createdAt: '2026-04-10T10:00:00.000Z',
    })
    useInvestmentStore.setState({ transactions: [
      inv({ pricePerUnit: 2000, date: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z' }),
      inv({ pricePerUnit: 4000, date: '2026-03-10', createdAt: '2026-03-10T10:00:00.000Z' }),
      sell,
    ] })
    await useInvestmentStore.getState().updateTransaction('sell-edit', { date: '2026-02-10' })
    expect(added.map(t => [t.type, t.amount])).toEqual([
      ['income', 100_000],
      ['income', 50_000],
    ])
  })
})
