import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Transaction } from '@/types'
import { setBaseRates } from '@/lib/utils/fx'

/* ────────────────────────────────────────────────────────────────────────
   transactions.store — amountTry snapshot bütünlüğü (S2/S3)

   `amountTry` KALICI bir snapshot'tır: baseAmount() bir kez yazılmış değeri
   döndürür, kurlar sonradan gelse bile düzeltmez. Bu yüzden yazma yolunun
   TAMAMI (add/withBase VE update) aynı kuralı uygulamak zorundadır: kur yoksa
   damgalama, temizle. Eskiden update() koşulsuz toBaseTry çağırıyordu ve
   fiyatlar yüklenmeden düzenlenen $100 kalıcı olarak 100₺ diye kaydoluyordu.

   Store Dexie + Supabase'e bağlı olduğundan I/O katmanı mock'lanır; test
   store'un KARARINI (hangi amountTry yazılıyor) doğrular.
──────────────────────────────────────────────────────────────────────── */

const patches: { id: string; patch: Record<string, unknown> }[] = []
const upserts: Record<string, unknown>[] = []

vi.mock('@/lib/db', () => ({
  db: { transactions: { toArray: async () => [] }, accounts: { get: async () => undefined } },
}))

vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async (_t: string, e: Record<string, unknown>) => { upserts.push(e) },
  localBulkUpsert: async (_t: string, es: Record<string, unknown>[]) => { upserts.push(...es) },
  localPatch: async (_t: string, id: string, patch: Record<string, unknown>) => { patches.push({ id, patch }) },
  softDelete: async () => {},
  softDeleteMany: async () => {},
  localBatch: async () => {},
  reconcilingPull: async () => [],
}))

// recomputeBalances cross-store etkisini sessizleştir (bakiye bu testin konusu değil)
vi.mock('./accounts.store', () => ({
  useAccountStore: { getState: () => ({ recomputeBalances: () => {}, accounts: [] }) },
}))

const { useTransactionStore } = await import('./transactions.store')

const usdTx: Transaction = {
  id: 'tx-usd', type: 'expense', amount: 100, currency: 'USD', date: '2026-01-10',
  accountId: 'a', description: 'Foreign spend', isInstallment: false,
  createdAt: '2026-01-10', updatedAt: '2026-01-10',
}

function seed(tx: Transaction) {
  useTransactionStore.setState({ transactions: [tx], ready: true, loading: false })
}

/** Kurları module-level state'ten temizlemek için taze fx instance'ı gerekir;
 *  setBaseRates(null) erken döner (mevcut kurları korur). */
async function withNoRates(fn: () => Promise<void>) {
  vi.resetModules()
  await fn()
}

describe('update() — amountTry snapshot', () => {
  beforeEach(() => {
    patches.length = 0
    upserts.length = 0
    setBaseRates({ usdTry: 42, eurTry: 46, gbpTry: 54 } as never)
  })

  it('re-stamps the snapshot when the amount changes and a rate exists', async () => {
    seed({ ...usdTx, amountTry: 4200 })
    await useTransactionStore.getState().update('tx-usd', { amount: 200 })

    expect(patches).toHaveLength(1)
    expect(patches[0].patch.amountTry).toBe(8400)          // 200 × 42
    expect(useTransactionStore.getState().transactions[0].amountTry).toBe(8400)
  })

  it('re-stamps when only the currency changes', async () => {
    seed({ ...usdTx, amountTry: 4200 })
    await useTransactionStore.getState().update('tx-usd', { currency: 'EUR' })
    expect(patches[0].patch.amountTry).toBe(4600)          // 100 × 46
  })

  it('leaves the snapshot untouched when neither amount nor currency changes', async () => {
    seed({ ...usdTx, amountTry: 4200 })
    await useTransactionStore.getState().update('tx-usd', { description: 'renamed' })
    expect('amountTry' in patches[0].patch).toBe(false)
    expect(useTransactionStore.getState().transactions[0].amountTry).toBe(4200)
  })

  it('TRY always has a rate → always stamps', async () => {
    seed({ id: 't', type: 'expense', amount: 50, currency: 'TRY', date: '2026-01-10',
           accountId: 'a', description: '', isInstallment: false, createdAt: '', updatedAt: '',
           amountTry: 50 })
    await useTransactionStore.getState().update('t', { amount: 75 })
    expect(patches[0].patch.amountTry).toBe(75)
  })
})

describe('update() — kur yüklenmeden düzenleme (regresyon)', () => {
  it('persists amountTry: null instead of the raw foreign amount', async () => {
    await withNoRates(async () => {
      const localPatches: { id: string; patch: Record<string, unknown> }[] = []
      vi.doMock('@/lib/db', () => ({
        db: { transactions: { toArray: async () => [] }, accounts: { get: async () => undefined } },
      }))
      vi.doMock('@/lib/sync/engine', () => ({
        localUpsert: async () => {}, localBulkUpsert: async () => {},
        localPatch: async (_t: string, id: string, patch: Record<string, unknown>) => { localPatches.push({ id, patch }) },
        softDelete: async () => {}, softDeleteMany: async () => {},
        localBatch: async () => {}, reconcilingPull: async () => [],
      }))
      vi.doMock('./accounts.store', () => ({
        useAccountStore: { getState: () => ({ recomputeBalances: () => {}, accounts: [] }) },
      }))

      const fx = await import('@/lib/utils/fx')
      expect(fx.rateFor('USD')).toBe(null)          // kurlar YOK

      const store = (await import('./transactions.store')).useTransactionStore
      store.setState({ transactions: [{ ...usdTx, amountTry: 4200 }], ready: true, loading: false })
      await store.getState().update('tx-usd', { amount: 200 })

      // KRİTİK: 200 (ham USD) değil, null yazılmalı — yoksa 200$ kalıcı 200₺ olur.
      expect(localPatches).toHaveLength(1)
      expect(localPatches[0].patch.amountTry).toBeNull()
      expect(localPatches[0].patch.amountTry).not.toBe(200)

      // Bellekteki satır da eski (artık yanlış) snapshot'ı taşımamalı
      const row = store.getState().transactions[0]
      expect(row.amountTry ?? null).toBeNull()

      // Kurlar gelince baseAmount canlı çevirir → doğru TRY değeri
      fx.setBaseRates({ usdTry: 42, eurTry: 46, gbpTry: 54 } as never)
      expect(fx.baseAmount(row)).toBe(8400)         // 200 × 42
    })
  })
})
