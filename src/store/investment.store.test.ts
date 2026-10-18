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
