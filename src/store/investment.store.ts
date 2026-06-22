'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import { useTransactionStore } from './transactions.store'
import type {
  InvestmentTransaction, InvestmentHolding,
  InvestmentAsset, PriceData, Transaction,
} from '@/types'

/* ── Asset helpers ───────────────────────────────────────────────── */

const GOLD_GRAMS: Partial<Record<InvestmentAsset, number>> = {
  GOLD_GRAM:    1,
  GOLD_QUARTER: 1.75,
  GOLD_HALF:    3.5,
  GOLD_FULL:    7.0,
  GOLD_OZ:      31.1035,
}

const ASSET_LABELS: Record<InvestmentAsset, string> = {
  GOLD_GRAM:    'Gr Altın',
  GOLD_QUARTER: 'Çeyrek Altın',
  GOLD_HALF:    'Yarım Altın',
  GOLD_FULL:    'Tam Altın',
  GOLD_OZ:      'Ons Altın',
  USD:          'USD',
  EUR:          'EUR',
  GBP:          'GBP',
}

function getAssetPrice(asset: InvestmentAsset, prices: PriceData): number {
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
  return `${fmtQty(qty)} ${ASSET_LABELS[asset]} Alımı`
}

function sellDescription(asset: InvestmentAsset, qty: number): string {
  return `${fmtQty(qty)} ${ASSET_LABELS[asset]} Satışı`
}

/* ── Linked-transaction helpers (module-level, use store.getState()) ── */

const ASSET_ICONS: Record<InvestmentAsset, string> = {
  GOLD_GRAM:    'Au',
  GOLD_QUARTER: 'Au',
  GOLD_HALF:    'Au',
  GOLD_FULL:    'Au',
  GOLD_OZ:      'Au',
  USD:          '$',
  EUR:          '€',
  GBP:          '£',
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
    icon:          ASSET_ICONS[asset],
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

  const { transactions: allTxs, remove: removeTx } = useTransactionStore.getState()
  const assetLabel = ASSET_LABELS[investTx.asset]

  const toDelete = allTxs.filter(t =>
    t.type === 'expense' &&
    t.accountId === investTx.sourceAccountId &&
    t.date === investTx.date &&
    t.description.includes(assetLabel) &&
    t.description.includes('Alım')
  )

  for (const t of toDelete) {
    await removeTx(t.id)
  }
}

async function createSellLinkedTxs(
  targetAccountId: string,
  asset: InvestmentAsset,
  quantity: number,
  total: number,      // qty × sell price (actual proceeds)
  costBasis: number,  // qty × avg cost per unit at time of sale (0 = unknown)
  date: string,
  createdAt?: string,
): Promise<string> {
  const now        = createdAt ?? new Date().toISOString()
  const txStore    = useTransactionStore.getState()
  const assetLabel = ASSET_LABELS[asset]

  // When cost basis is known: split into capital return + P&L.
  // When unknown: one income tx for full proceeds.
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
    icon:          ASSET_ICONS[asset],
    description:   sellDescription(asset, quantity),
    isInstallment: false,
    createdAt:     now,
    updatedAt:     now,
  }
  await txStore.add(saleLinked)

  if (hasCost && Math.abs(pnl) >= 0.01) {
    const isPnlIncome = pnl > 0
    const pnlLinked: Transaction = {
      id:            crypto.randomUUID(),
      type:          isPnlIncome ? 'income' : 'expense',
      amount:        Math.abs(pnl),
      currency:      'TRY',
      date,
      accountId:     targetAccountId,
      icon:          ASSET_ICONS[asset],
      description:   isPnlIncome
        ? `${assetLabel} Satış Kârı`
        : `${assetLabel} Satış Zararı`,
      isInstallment: false,
      createdAt:     now,
      updatedAt:     now,
    }
    await txStore.add(pnlLinked)
  }

  return saleLinked.id
}

async function cleanSellLinkedTxs(investTx: InvestmentTransaction): Promise<void> {
  if (!investTx.targetAccountId) return

  const { transactions: allTxs, remove: removeTx } = useTransactionStore.getState()
  const assetLabel = ASSET_LABELS[investTx.asset]

  // Matches both the capital-return income tx ("Satışı") and the P&L tx ("Satış Kârı/Zararı")
  const toDelete = allTxs.filter(t =>
    (t.type === 'income' || t.type === 'expense') &&
    t.accountId === investTx.targetAccountId &&
    t.date === investTx.date &&
    t.description.includes(assetLabel) &&
    t.description.includes('Satış')
  )

  for (const t of toDelete) {
    await removeTx(t.id)
  }
}

/* ── Portfolio calculation ───────────────────────────────────────── */

export function computeHoldings(
  transactions: InvestmentTransaction[],
  prices: PriceData | null,
): InvestmentHolding[] {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date))

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
    const currentPrice   = prices ? getAssetPrice(asset, prices) : 0
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
  transactions:  InvestmentTransaction[]
  prices:        PriceData | null
  pricesLoading: boolean
  pricesError:   string | null
  loading:       boolean

  load:                    () => Promise<void>
  addTransaction:          (tx: InvestmentTransaction) => Promise<void>
  updateTransaction:       (id: string, patch: Partial<InvestmentTransaction>) => Promise<void>
  removeTransaction:       (id: string) => Promise<void>
  reprocessSellLinkedTxs:  () => Promise<void>
  fetchPrices:             () => Promise<void>
  getHoldings:             () => InvestmentHolding[]
  getPortfolioValue:       () => number
}

export const useInvestmentStore = create<InvestmentState>()((set, get) => ({
  transactions:  [],
  prices:        null,
  pricesLoading: false,
  pricesError:   null,
  loading:       false,

  load: async () => {
    set({ loading: true })
    const txs = await db.investmentTransactions.orderBy('date').reverse().toArray()
    set({ transactions: txs, loading: false })
  },

  addTransaction: async (tx) => {
    let linkedTransactionId: string | undefined
    const total = tx.quantity * tx.pricePerUnit

    if (tx.type === 'buy' && tx.sourceAccountId) {
      linkedTransactionId = await createLinkedTx(
        tx.sourceAccountId, tx.asset, tx.quantity, total, tx.date, tx.createdAt,
      )
    } else if (tx.type === 'sell' && tx.targetAccountId) {
      // Cost basis from holdings BEFORE this sell is recorded
      const holdings  = computeHoldings(get().transactions, null)
      const holding   = holdings.find(h => h.asset === tx.asset)
      const costBasis = holding ? tx.quantity * holding.avgCostPerUnit : 0
      linkedTransactionId = await createSellLinkedTxs(
        tx.targetAccountId, tx.asset, tx.quantity, total, costBasis, tx.date, tx.createdAt,
      )
    }

    const finalTx = { ...tx, linkedTransactionId }
    await db.investmentTransactions.add(finalTx)
    set(s => ({ transactions: [finalTx, ...s.transactions] }))
  },

  updateTransaction: async (id, patch) => {
    const oldTx = get().transactions.find(t => t.id === id)
    if (!oldTx) return

    await cleanLinkedTxs(oldTx)
    await cleanSellLinkedTxs(oldTx)

    const newTx    = { ...oldTx, ...patch }
    const newTotal = newTx.quantity * newTx.pricePerUnit
    let linkedTransactionId: string | undefined

    if (newTx.type === 'buy' && newTx.sourceAccountId) {
      linkedTransactionId = await createLinkedTx(
        newTx.sourceAccountId, newTx.asset, newTx.quantity, newTotal, newTx.date, newTx.createdAt,
      )
    } else if (newTx.type === 'sell' && newTx.targetAccountId) {
      // Cost basis computed as if the old tx never existed
      const txsWithoutOld = get().transactions.filter(t => t.id !== id)
      const holdings      = computeHoldings(txsWithoutOld, null)
      const holding       = holdings.find(h => h.asset === newTx.asset)
      const costBasis     = holding ? newTx.quantity * holding.avgCostPerUnit : 0
      linkedTransactionId = await createSellLinkedTxs(
        newTx.targetAccountId, newTx.asset, newTx.quantity, newTotal, costBasis, newTx.date, newTx.createdAt,
      )
    }

    const finalPatch = { ...patch, linkedTransactionId }
    await db.investmentTransactions.update(id, finalPatch)
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

    await db.investmentTransactions.delete(id)
    set(s => ({ transactions: s.transactions.filter(t => t.id !== id) }))
  },

  reprocessSellLinkedTxs: async () => {
    // Guard: localStorage key set synchronously prevents concurrent/repeat runs.
    // Bump version suffix to force a re-run after logic changes.
    const MIGRATION_KEY = 'inv_sell_pnl_v3'
    if (typeof window !== 'undefined') {
      if (localStorage.getItem(MIGRATION_KEY)) return
      localStorage.setItem(MIGRATION_KEY, '1')  // sync — blocks any concurrent call
    }

    try {
      // Sort all investment txs chronologically to reconstruct portfolio state in order
      const sorted = [...get().transactions].sort((a, b) => {
        const d = a.date.localeCompare(b.date)
        return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt)
      })

      // Running portfolio: asset → { qty, totalCost }
      const portfolio = new Map<InvestmentAsset, { qty: number; totalCost: number }>()

      for (const tx of sorted) {
        const pos = portfolio.get(tx.asset) ?? { qty: 0, totalCost: 0 }

        if (tx.type === 'buy') {
          pos.qty       += tx.quantity
          pos.totalCost += tx.quantity * tx.pricePerUnit
          portfolio.set(tx.asset, { ...pos })
        } else {
          // Sell — compute avg cost BEFORE this sell reduces the position
          const avgCost   = pos.qty > 0 ? pos.totalCost / pos.qty : 0
          const costBasis = tx.quantity * avgCost

          if (tx.targetAccountId) {
            await cleanSellLinkedTxs(tx)
            const total       = tx.quantity * tx.pricePerUnit
            const newLinkedId = await createSellLinkedTxs(
              tx.targetAccountId, tx.asset, tx.quantity, total, costBasis, tx.date, tx.createdAt,
            )
            await db.investmentTransactions.update(tx.id, { linkedTransactionId: newLinkedId })
          }

          // Reduce portfolio after sell
          const newQty = Math.max(0, pos.qty - tx.quantity)
          portfolio.set(tx.asset, { qty: newQty, totalCost: newQty * avgCost })
        }
      }

      // Reload to reflect updated linkedTransactionIds
      const txs = await db.investmentTransactions.orderBy('date').reverse().toArray()
      set({ transactions: txs })
    } catch (err) {
      // On failure, remove key so it can retry on next load
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
    } catch (err) {
      set({ pricesError: err instanceof Error ? err.message : 'Bağlantı hatası' })
    } finally {
      set({ pricesLoading: false })
    }
  },

  getHoldings:       () => computeHoldings(get().transactions, get().prices),
  getPortfolioValue: () => {
    const { prices } = get()
    if (!prices) return 0
    return computeHoldings(get().transactions, prices).reduce((s, h) => s + h.currentValue, 0)
  },
}))
