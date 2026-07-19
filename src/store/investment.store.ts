'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localPatch, softDelete } from '@/lib/sync/engine'
import { loadEntities } from './entity-helpers'
import { setBaseRates } from '@/lib/utils/fx'
import { sellCleanupTxIds } from '@/lib/utils/investment-links'
import { useTransactionStore } from './transactions.store'
import { isTefasAsset, tefasCode, tefasCodesIn } from '@/lib/tefas'
import type {
  InvestmentTransaction, InvestmentHolding,
  InvestmentAsset, StaticInvestmentAsset, PriceData, Transaction,
  TefasFundPrice,
} from '@/types'

/* ── Asset helpers ───────────────────────────────────────────────── */

// Gram altın karşılıkları — canlı Türkiye kotasyonu yoksa fallback ve grafikte
// gram-eşdeğeri hesabı için. Ziynetler 22 ayar: brüt gramaj × 0.916 milyem
// (çeyrek 1.754 g, yarım 3.508 g, tam 7.016 g)
export const GOLD_GRAMS: Partial<Record<InvestmentAsset, number>> = {
  GOLD_GRAM:    1,
  GOLD_QUARTER: 1.6067,
  GOLD_HALF:    3.2133,
  GOLD_FULL:    6.4267,
  GOLD_OZ:      31.1035,
  GOLD_BRACELET: 0.916,
}

const ASSET_LABELS: Record<StaticInvestmentAsset, string> = {
  GOLD_GRAM:    'Gr Altın',
  GOLD_QUARTER: 'Çeyrek Altın',
  GOLD_HALF:    'Yarım Altın',
  GOLD_FULL:    'Tam Altın',
  GOLD_OZ:      'Ons Altın',
  GOLD_BRACELET: 'Gr Bilezik',
  USD:          'USD',
  EUR:          'EUR',
  GBP:          'GBP',
}

// TEFAS fonları dinamik olduğundan etiket/ikon sabit map yerine fonksiyonla çözülür
export function assetLabel(asset: InvestmentAsset): string {
  return isTefasAsset(asset) ? tefasCode(asset) : ASSET_LABELS[asset]
}

export function getAssetPrice(
  asset: InvestmentAsset,
  prices: PriceData | null,
  fundPrices?: Record<string, TefasFundPrice>,
): number {
  if (isTefasAsset(asset)) return fundPrices?.[tefasCode(asset)]?.price ?? 0
  if (!prices) return 0
  // Ziynet altınları (çeyrek/yarım/tam/bilezik) 22 ayar — fiyatları gram altından
  // ayrışır; önce Türkiye kuyum piyasası kotasyonu, yoksa gram karşılığı çarpan
  if (asset === 'GOLD_QUARTER'  && prices.goldQuarterTry) return prices.goldQuarterTry
  if (asset === 'GOLD_HALF'     && prices.goldHalfTry)    return prices.goldHalfTry
  if (asset === 'GOLD_FULL'     && prices.goldFullTry)    return prices.goldFullTry
  if (asset === 'GOLD_BRACELET' && prices.bilezikGramTry) return prices.bilezikGramTry
  if (asset in GOLD_GRAMS) return prices.goldGramTry * GOLD_GRAMS[asset]!
  if (asset === 'USD') return prices.usdTry
  if (asset === 'EUR') return prices.eurTry
  if (asset === 'GBP') return prices.gbpTry
  return 0
}

function fmtQty(qty: number) {
  return qty % 1 === 0
    ? qty.toLocaleString('tr-TR')
    : qty.toLocaleString('tr-TR', { maximumFractionDigits: 4 })
}

function buyDescription(asset: InvestmentAsset, qty: number): string {
  return `${fmtQty(qty)} ${assetLabel(asset)} Alımı`
}

function sellDescription(asset: InvestmentAsset, qty: number): string {
  return `${fmtQty(qty)} ${assetLabel(asset)} Satışı`
}

/* ── Linked-transaction helpers (module-level, use store.getState()) ── */

const ASSET_ICONS: Record<StaticInvestmentAsset, string> = {
  GOLD_GRAM:    'Au',
  GOLD_QUARTER: 'Au',
  GOLD_HALF:    'Au',
  GOLD_FULL:    'Au',
  GOLD_OZ:      'Au',
  GOLD_BRACELET: 'Au',
  USD:          '$',
  EUR:          '€',
  GBP:          '£',
}

export function assetIcon(asset: InvestmentAsset): string {
  return isTefasAsset(asset) ? 'F' : ASSET_ICONS[asset]
}

async function createLinkedTx(
  sourceAccountId: string,
  asset: InvestmentAsset,
  quantity: number,
  total: number,
  date: string,
  createdAt?: string,
): Promise<string> {
  const now    = createdAt ?? new Date().toISOString()
  const linked: Transaction = {
    id:            crypto.randomUUID(),
    type:          'expense',
    amount:        total,
    currency:      'TRY',
    date,
    accountId:     sourceAccountId,
    icon:          assetIcon(asset),
    description:   buyDescription(asset, quantity),
    isInstallment: false,
    createdAt:     now,
    updatedAt:     now,
  }
  await useTransactionStore.getState().add(linked)
  return linked.id
}

async function cleanLinkedTxs(investTx: InvestmentTransaction): Promise<void> {
  if (!investTx.sourceAccountId) return

  const txStore = useTransactionStore.getState()

  // Linked ledger txs are an implementation detail of the investment record —
  // suppress their individual undo toasts (the invest tx restore is out of scope).
  if (investTx.linkedTransactionId) {
    await txStore.remove(investTx.linkedTransactionId, { undoable: false })
    return
  }

  const label = assetLabel(investTx.asset)
  const toDelete = txStore.transactions.filter(t =>
    t.type === 'expense' &&
    t.accountId === investTx.sourceAccountId &&
    t.date === investTx.date &&
    t.description.includes(label) &&
    t.description.includes('Alım'),
  )
  for (const t of toDelete) await txStore.remove(t.id, { undoable: false })
}

async function createSellLinkedTxs(
  targetAccountId: string,
  asset: InvestmentAsset,
  quantity: number,
  total: number,
  costBasis: number,
  date: string,
  createdAt?: string,
): Promise<{ saleId: string; pnlId?: string }> {
  const now        = createdAt ?? new Date().toISOString()
  const txStore    = useTransactionStore.getState()
  const label = assetLabel(asset)

  const hasCost    = costBasis > 0.001
  const saleAmount = hasCost ? costBasis : total
  const pnl        = hasCost ? total - costBasis : 0

  const saleLinked: Transaction = {
    id:            crypto.randomUUID(),
    type:          'income',
    amount:        saleAmount,
    currency:      'TRY',
    date,
    accountId:     targetAccountId,
    icon:          assetIcon(asset),
    description:   sellDescription(asset, quantity),
    isInstallment: false,
    createdAt:     now,
    updatedAt:     now,
  }
  await txStore.add(saleLinked)

  let pnlId: string | undefined
  if (hasCost && Math.abs(pnl) >= 0.01) {
    const isPnlIncome = pnl > 0
    const pnlLinked: Transaction = {
      id:            crypto.randomUUID(),
      type:          isPnlIncome ? 'income' : 'expense',
      amount:        Math.abs(pnl),
      currency:      'TRY',
      date,
      accountId:     targetAccountId,
      icon:          assetIcon(asset),
      description:   isPnlIncome
        ? `${label} Satış Kârı`
        : `${label} Satış Zararı`,
      isInstallment: false,
      createdAt:     now,
      updatedAt:     now,
    }
    await txStore.add(pnlLinked)
    pnlId = pnlLinked.id
  }

  return { saleId: saleLinked.id, pnlId }
}

async function cleanSellLinkedTxs(investTx: InvestmentTransaction): Promise<void> {
  const txStore = useTransactionStore.getState()
  const ids = sellCleanupTxIds(investTx, assetLabel(investTx.asset), txStore.transactions)
  for (const id of ids) await txStore.remove(id, { undoable: false })
}

/* ── Portfolio calculation ───────────────────────────────────────── */

export function computeHoldings(
  transactions: InvestmentTransaction[],
  prices: PriceData | null,
  fundPrices?: Record<string, TefasFundPrice>,
): InvestmentHolding[] {
  // createdAt tiebreak: aynı gün al+sat sırası belirsiz kalırsa Math.max(0,…)
  // kırpması qty'yi şişirebilir (satış önce işlenirse). Grafik zaman çizelgesi
  // (investments/page.tsx) ile aynı sıralama — özet ve grafik hizalı kalsın.
  const sorted = [...transactions].sort((a, b) =>
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))

  const map = new Map<InvestmentAsset, { qty: number; totalCost: number }>()
  for (const tx of sorted) {
    if (!map.has(tx.asset)) map.set(tx.asset, { qty: 0, totalCost: 0 })
    const pos = map.get(tx.asset)!
    if (tx.type === 'buy') {
      pos.totalCost += tx.quantity * tx.pricePerUnit
      pos.qty       += tx.quantity
    } else {
      const avgCost  = pos.qty > 0 ? pos.totalCost / pos.qty : 0
      pos.qty        = Math.max(0, pos.qty - tx.quantity)
      pos.totalCost  = pos.qty * avgCost
    }
  }

  const holdings: InvestmentHolding[] = []
  for (const [asset, pos] of map) {
    if (pos.qty < 0.000001) continue
    const avgCostPerUnit = pos.qty > 0 ? pos.totalCost / pos.qty : 0
    const currentPrice   = getAssetPrice(asset, prices, fundPrices)
    const currentValue   = pos.qty * currentPrice
    const pnl            = currentValue - pos.totalCost
    const pnlPercent     = pos.totalCost > 0 ? (pnl / pos.totalCost) * 100 : 0
    holdings.push({
      asset, quantity: pos.qty,
      avgCostPerUnit, totalCost: pos.totalCost,
      currentPrice, currentValue, pnl, pnlPercent,
    })
  }
  return holdings
}

/* ── Store ───────────────────────────────────────────────────────── */

interface InvestmentState {
  transactions:      InvestmentTransaction[]
  prices:            PriceData | null
  pricesLoading:     boolean
  pricesError:       string | null
  fundPrices:        Record<string, TefasFundPrice>
  fundPricesLoading: boolean
  loading:           boolean

  load:                    () => Promise<void>
  addTransaction:          (tx: InvestmentTransaction) => Promise<void>
  updateTransaction:       (id: string, patch: Partial<InvestmentTransaction>) => Promise<void>
  removeTransaction:       (id: string) => Promise<void>
  reprocessSellLinkedTxs:  () => Promise<void>
  fetchPrices:             () => Promise<void>
  fetchFundPrices:         (extraCodes?: string[]) => Promise<void>
  getHoldings:             () => InvestmentHolding[]
  getPortfolioValue:       () => number
}

export const useInvestmentStore = create<InvestmentState>()((set, get) => ({
  transactions:      [],
  prices:            null,
  pricesLoading:     false,
  pricesError:       null,
  fundPrices:        {},
  fundPricesLoading: false,
  loading:           false,

  load: async () => {
    set({ loading: true })
    // NOTE: the two branches order differently on ties (cloud path: JS sort by
    // date desc; Dexie fallback: orderBy('date').reverse()), so the fallback
    // stays self-contained and `post` only re-sorts the reconciled cloud rows.
    const txs = await loadEntities<InvestmentTransaction>(
      'investment_transactions', 'investment',
      async () => (await db.investmentTransactions.orderBy('date').reverse().toArray()).filter(isLive),
      rows => rows.sort((a, b) => b.date.localeCompare(a.date)),
    )
    set({ transactions: txs, loading: false })
    // Fon kodları işlemlerden türediği için fiyatları ancak yükleme sonrası çekebiliriz
    void get().fetchFundPrices()
  },

  addTransaction: async (tx) => {
    let linkedTransactionId: string | undefined
    let pnlLinkedTransactionId: string | undefined
    const total = tx.quantity * tx.pricePerUnit

    if (tx.type === 'buy' && tx.sourceAccountId) {
      linkedTransactionId = await createLinkedTx(
        tx.sourceAccountId, tx.asset, tx.quantity, total, tx.date, tx.createdAt,
      )
    } else if (tx.type === 'sell' && tx.targetAccountId) {
      const holdings  = computeHoldings(get().transactions, null)
      const holding   = holdings.find(h => h.asset === tx.asset)
      const costBasis = holding ? tx.quantity * holding.avgCostPerUnit : 0
      const linked = await createSellLinkedTxs(
        tx.targetAccountId, tx.asset, tx.quantity, total, costBasis, tx.date, tx.createdAt,
      )
      linkedTransactionId    = linked.saleId
      pnlLinkedTransactionId = linked.pnlId
    }

    const finalTx = { ...tx, linkedTransactionId, pnlLinkedTransactionId }
    await localUpsert('investment_transactions', finalTx)
    set(s => ({ transactions: [finalTx, ...s.transactions] }))

    // Yeni bir TEFAS fonu eklendiyse fiyatı hemen çek (portföy değeri güncellensin)
    if (isTefasAsset(tx.asset) && !get().fundPrices[tefasCode(tx.asset)]) {
      void get().fetchFundPrices()
    }
  },

  updateTransaction: async (id, patch) => {
    const oldTx = get().transactions.find(t => t.id === id)
    if (!oldTx) return

    await cleanLinkedTxs(oldTx)
    await cleanSellLinkedTxs(oldTx)

    const newTx    = { ...oldTx, ...patch }
    const newTotal = newTx.quantity * newTx.pricePerUnit
    let linkedTransactionId: string | undefined
    let pnlLinkedTransactionId: string | undefined

    if (newTx.type === 'buy' && newTx.sourceAccountId) {
      linkedTransactionId = await createLinkedTx(
        newTx.sourceAccountId, newTx.asset, newTx.quantity, newTotal, newTx.date, newTx.createdAt,
      )
    } else if (newTx.type === 'sell' && newTx.targetAccountId) {
      const txsWithoutOld = get().transactions.filter(t => t.id !== id)
      const holdings      = computeHoldings(txsWithoutOld, null)
      const holding       = holdings.find(h => h.asset === newTx.asset)
      const costBasis     = holding ? newTx.quantity * holding.avgCostPerUnit : 0
      const linked = await createSellLinkedTxs(
        newTx.targetAccountId, newTx.asset, newTx.quantity, newTotal, costBasis, newTx.date, newTx.createdAt,
      )
      linkedTransactionId    = linked.saleId
      pnlLinkedTransactionId = linked.pnlId
    }

    // undefined bacaklar localPatch'te null'a çevrilip alanı temizler (buy'a
    // dönüşen satışın eski P&L bağı kalıntı bırakmasın)
    const finalPatch = { ...patch, linkedTransactionId, pnlLinkedTransactionId }
    await localPatch('investment_transactions', id, finalPatch as Record<string, unknown>)
    set(s => ({
      transactions: s.transactions.map(t => t.id === id ? { ...t, ...finalPatch } : t),
    }))
  },

  removeTransaction: async (id) => {
    const tx = get().transactions.find(t => t.id === id)

    if (tx?.type === 'buy' && tx.sourceAccountId) {
      await cleanLinkedTxs(tx)
    } else if (tx?.type === 'sell' && tx.targetAccountId) {
      await cleanSellLinkedTxs(tx)
    }

    // C3 — soft delete via durable outbox. Linked ledger txs are removed via
    // txStore.remove above, which is itself now a tombstone.
    await softDelete('investment_transactions', id)
    set(s => ({ transactions: s.transactions.filter(t => t.id !== id) }))
  },

  reprocessSellLinkedTxs: async () => {
    const MIGRATION_KEY = 'inv_sell_pnl_v3'
    if (typeof window !== 'undefined') {
      if (localStorage.getItem(MIGRATION_KEY)) return
      localStorage.setItem(MIGRATION_KEY, '1')
    }

    try {
      const sorted = [...get().transactions].sort((a, b) => {
        const d = a.date.localeCompare(b.date)
        return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
      })

      const portfolio = new Map<InvestmentAsset, { qty: number; totalCost: number }>()

      for (const tx of sorted) {
        const pos = portfolio.get(tx.asset) ?? { qty: 0, totalCost: 0 }

        if (tx.type === 'buy') {
          pos.qty       += tx.quantity
          pos.totalCost += tx.quantity * tx.pricePerUnit
          portfolio.set(tx.asset, { ...pos })
        } else {
          const avgCost   = pos.qty > 0 ? pos.totalCost / pos.qty : 0
          const costBasis = tx.quantity * avgCost

          if (tx.targetAccountId) {
            await cleanSellLinkedTxs(tx)
            const total  = tx.quantity * tx.pricePerUnit
            const linked = await createSellLinkedTxs(
              tx.targetAccountId, tx.asset, tx.quantity, total, costBasis, tx.date, tx.createdAt,
            )
            await localPatch('investment_transactions', tx.id, {
              linkedTransactionId:    linked.saleId,
              pnlLinkedTransactionId: linked.pnlId,
            })
          }

          const newQty = Math.max(0, pos.qty - tx.quantity)
          portfolio.set(tx.asset, { qty: newQty, totalCost: newQty * avgCost })
        }
      }

      const txs = (await db.investmentTransactions.orderBy('date').reverse().toArray()).filter(isLive)
      set({ transactions: txs })
    } catch (err) {
      if (typeof window !== 'undefined') localStorage.removeItem(MIGRATION_KEY)
      throw err
    }
  },

  fetchPrices: async () => {
    if (get().pricesLoading) return
    set({ pricesLoading: true })
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' })
      if (!res.ok) throw new Error(`${res.status}`)
      const data: PriceData = await res.json()
      if ('error' in data) throw new Error(String((data as Record<string, unknown>).error))
      set({ prices: data, pricesError: null })
      setBaseRates(data) // publish live FX rates for base-currency normalization (S2/S3)
    } catch (err) {
      set({ pricesError: err instanceof Error ? err.message : 'Bağlantı hatası' })
    } finally {
      set({ pricesLoading: false })
    }
    // TEFAS fiyatlarını da tazele — route tarafındaki cache sayesinde 60 sn'lik
    // polling TEFAS'a en fazla ~10 dk'da bir yansır
    void get().fetchFundPrices()
  },

  fetchFundPrices: async (extraCodes = []) => {
    const codes = new Set([
      ...tefasCodesIn(get().transactions.map(t => t.asset)),
      ...extraCodes.map(c => c.trim().toUpperCase()).filter(Boolean),
    ])
    if (!codes.size || get().fundPricesLoading) return
    set({ fundPricesLoading: true })
    try {
      const res = await fetch(`/api/prices/tefas?codes=${[...codes].join(',')}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`${res.status}`)
      const data: { funds: Record<string, TefasFundPrice | null> } = await res.json()
      const merged = { ...get().fundPrices }
      for (const [code, fp] of Object.entries(data.funds ?? {})) {
        if (fp) merged[code] = fp
      }
      set({ fundPrices: merged })
    } catch {
      // FX fiyatlarından bağımsız, sessizce geç — eldeki son fon fiyatı kullanılmaya devam eder
    } finally {
      set({ fundPricesLoading: false })
    }
  },

  getHoldings:       () => computeHoldings(get().transactions, get().prices, get().fundPrices),
  getPortfolioValue: () =>
    computeHoldings(get().transactions, get().prices, get().fundPrices)
      .reduce((s, h) => s + h.currentValue, 0),
}))