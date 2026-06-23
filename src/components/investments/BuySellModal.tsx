'use client'

import { useState, useEffect } from 'react'
import { useInvestmentStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import type { InvestmentAsset, InvestmentTransaction } from '@/types'

const ASSETS: { asset: InvestmentAsset; label: string; emoji: string; unit: string }[] = [
  { asset: 'GOLD_GRAM',    label: 'Gram Altın',       emoji: '🥇', unit: 'gr' },
  { asset: 'GOLD_QUARTER', label: 'Çeyrek Altın',     emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_HALF',    label: 'Yarım Altın',      emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_FULL',    label: 'Tam Altın',        emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_OZ',      label: 'Ons Altın',        emoji: '🥇', unit: 'oz' },
  { asset: 'USD',          label: 'ABD Doları',       emoji: '🇺🇸', unit: '$' },
  { asset: 'EUR',          label: 'Euro',             emoji: '🇪🇺', unit: '€' },
  { asset: 'GBP',          label: 'İngiliz Sterlini', emoji: '🇬🇧', unit: '£' },
]

const GOLD_GRAMS: Partial<Record<InvestmentAsset, number>> = {
  GOLD_GRAM: 1, GOLD_QUARTER: 1.75, GOLD_HALF: 3.5, GOLD_FULL: 7.0, GOLD_OZ: 31.1035,
}

interface Props {
  open: boolean
  defaultType?: 'buy' | 'sell'
  editingTx?: InvestmentTransaction | null
  onClose: () => void
}

export function BuySellModal({ open, defaultType = 'buy', editingTx, onClose }: Props) {
  const { addTransaction, updateTransaction, prices, getHoldings } = useInvestmentStore()
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))

  const isEdit = !!editingTx

  const [txType,         setTxType]         = useState<'buy' | 'sell'>(defaultType)
  const [asset,          setAsset]          = useState<InvestmentAsset>('GOLD_GRAM')
  const [qty,            setQty]            = useState('')
  const [price,          setPrice]          = useState('')
  const [accountId,      setAccountId]      = useState('')   // buy: source account
  const [targetAccId,    setTargetAccId]    = useState('')   // sell: target account
  const [date,           setDate]           = useState(today())
  const [note,           setNote]           = useState('')
  const [saving,         setSaving]         = useState(false)
  const [fetchingPrice,  setFetchingPrice]  = useState(false)

  // Populate form when modal opens
  useEffect(() => {
    if (!open) return
    if (editingTx) {
      setTxType(editingTx.type)
      setAsset(editingTx.asset)
      setQty(String(editingTx.quantity))
      setPrice(String(editingTx.pricePerUnit))
      setAccountId(editingTx.sourceAccountId ?? '')
      setTargetAccId(editingTx.targetAccountId ?? '')
      setDate(editingTx.date)
      setNote(editingTx.note ?? '')
    } else {
      setTxType(defaultType)
      const held = getHoldings().filter(h => h.quantity > 0.000001).map(h => h.asset)
      const firstHeld = held[0]
      setAsset(defaultType === 'sell' && firstHeld ? firstHeld : 'GOLD_GRAM')
      setQty('')
      setPrice('')
      setAccountId('')
      setTargetAccId('')
      setDate(today())
      setNote('')
    }
  }, [open, editingTx, defaultType])

  function fillLivePrice() {
    if (!prices) return
    let livePrice = 0
    if (asset in GOLD_GRAMS) livePrice = prices.goldGramTry * GOLD_GRAMS[asset]!
    else if (asset === 'USD') livePrice = prices.usdTry
    else if (asset === 'EUR') livePrice = prices.eurTry
    else if (asset === 'GBP') livePrice = prices.gbpTry
    if (livePrice > 0) setPrice(livePrice.toFixed(2))
  }

  // Auto-fill price when date or asset changes (new transactions only)
  useEffect(() => {
    if (!open || editingTx) return
    if (!date) return

    const todayStr = today()

    if (date === todayStr) {
      if (!prices) return
      let p = 0
      if (asset in GOLD_GRAMS) p = prices.goldGramTry * GOLD_GRAMS[asset]!
      else if (asset === 'USD') p = prices.usdTry
      else if (asset === 'EUR') p = prices.eurTry
      else if (asset === 'GBP') p = prices.gbpTry
      if (p > 0) setPrice(p.toFixed(2))
      return
    }

    if (date > todayStr) return

    const group = (asset in GOLD_GRAMS ? 'GOLD' : asset) as 'GOLD' | 'USD' | 'EUR' | 'GBP'
    const gramMult = GOLD_GRAMS[asset] ?? 1

    const ctrl = new AbortController()
    setFetchingPrice(true)

    fetch(`/api/prices/history?asset=${group}&from=${date}&buyDates=${date}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((pts: { date: string; price: number }[]) => {
        const pt = pts.find(p => p.date === date) ?? pts[pts.length - 1]
        if (pt) {
          const unitPrice = group === 'GOLD' ? pt.price * gramMult : pt.price
          setPrice(unitPrice.toFixed(2))
        }
      })
      .catch(() => {})
      .finally(() => setFetchingPrice(false))

    return () => ctrl.abort()
  }, [open, date, asset, editingTx, prices])

  const qtyNum    = parseFloat(qty)   || 0
  const priceNum  = parseFloat(price) || 0
  const total     = qtyNum * priceNum

  // Sell validation
  const holdings        = getHoldings()
  const sellableAssets  = ASSETS.filter(a => holdings.some(h => h.asset === a.asset && h.quantity > 0.000001))
  const visibleAssets   = txType === 'sell' && !isEdit ? sellableAssets : ASSETS
  const assetMeta       = visibleAssets.find(a => a.asset === asset) ?? ASSETS.find(a => a.asset === asset)!
  const currentHolding  = holdings.find(h => h.asset === asset)
  const heldQty         = currentHolding?.quantity ?? 0
  const editOffset      = isEdit && editingTx?.type === 'sell' ? editingTx.quantity : 0
  const maxSell         = txType === 'sell'
    ? heldQty + (isEdit && txType === editingTx?.type ? editOffset : 0)
    : Infinity
  const sellExceeded = txType === 'sell' && qtyNum > maxSell

  const canSave = qtyNum > 0 && priceNum > 0 && date && !sellExceeded && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)

    if (isEdit && editingTx) {
      await updateTransaction(editingTx.id, {
        type:            txType,
        asset,
        quantity:        qtyNum,
        pricePerUnit:    priceNum,
        sourceAccountId: txType === 'buy'  && accountId   ? accountId   : undefined,
        targetAccountId: txType === 'sell' && targetAccId ? targetAccId : undefined,
        date,
        note:            note.trim() || undefined,
      })
    } else {
      const tx: InvestmentTransaction = {
        id:              crypto.randomUUID(),
        type:            txType,
        asset,
        quantity:        qtyNum,
        pricePerUnit:    priceNum,
        sourceAccountId: txType === 'buy'  && accountId   ? accountId   : undefined,
        targetAccountId: txType === 'sell' && targetAccId ? targetAccId : undefined,
        date,
        note:            note.trim() || undefined,
        createdAt:       new Date().toISOString(),
      }
      await addTransaction(tx)
    }

    setSaving(false)
    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden border border-border">

        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <span className="text-base font-semibold text-foreground">
            {isEdit ? 'İşlemi Düzenle' : 'Yatırım İşlemi'}
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >✕</button>
        </div>

        <div className="p-6 flex flex-col gap-4">

          {/* Buy / Sell toggle */}
          <div className="flex rounded-xl overflow-hidden border border-border">
            <button
              onClick={() => setTxType('buy')}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${txType === 'buy' ? 'bg-green-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Al
            </button>
            <button
              onClick={() => {
                setTxType('sell')
                if (!sellableAssets.some(a => a.asset === asset)) {
                  const first = sellableAssets[0]?.asset
                  if (first) setAsset(first)
                }
              }}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${txType === 'sell' ? 'bg-destructive text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Sat
            </button>
          </div>

          {/* Asset */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Varlık</label>
            <select
              value={asset}
              onChange={e => { setAsset(e.target.value as InvestmentAsset); setPrice('') }}
              className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent cursor-pointer"
            >
              {visibleAssets.map(a => (
                <option key={a.asset} value={a.asset}>{a.emoji} {a.label}</option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Miktar ({assetMeta.unit})
              </label>
              {txType === 'sell' && maxSell > 0 && maxSell < Infinity && (
                <button
                  onClick={() => setQty(maxSell % 1 === 0 ? String(maxSell) : maxSell.toFixed(4).replace(/\.?0+$/, ''))}
                  className="text-xs text-primary font-semibold hover:text-primary/80 transition-colors"
                >
                  Tümünü sat ({maxSell.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} {assetMeta.unit})
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="0"
                min={0}
                step="any"
                className="w-full text-sm border border-border rounded-xl px-3 pr-16 h-10 bg-background text-foreground focus:outline-none focus:border-accent"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                {assetMeta.unit}
              </span>
            </div>
            {txType === 'sell' && maxSell < Infinity && maxSell > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                Portföyde: {maxSell.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} {assetMeta.unit}
              </div>
            )}
            {sellExceeded && (
              <div className="mt-1 text-xs text-destructive font-medium">
                Portföyden fazla miktar satılamaz.
              </div>
            )}
          </div>

          {/* Price per unit */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Birim Fiyat (₺)
              </label>
              {fetchingPrice ? (
                <span className="text-xs text-muted-foreground animate-pulse">Fiyat yükleniyor...</span>
              ) : prices && (
                <button
                  onClick={fillLivePrice}
                  className="text-xs text-primary font-semibold hover:text-primary/80 transition-colors"
                >
                  Canlı fiyatı kullan
                </button>
              )}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₺</span>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0.00"
                min={0}
                step="any"
                disabled={fetchingPrice}
                className="w-full text-sm border border-border rounded-xl pl-7 pr-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
          </div>

          {/* Source account (buy only) */}
          {txType === 'buy' && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                Hangi hesaptan? (isteğe bağlı)
              </label>
              <select
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">Hesap seçme — dış kaynak</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatCurrency(a.balance, a.currency)})
                  </option>
                ))}
              </select>
              {accountId && total > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Seçilen hesaptan {formatCurrency(total)} düşülecek.
                </div>
              )}
            </div>
          )}

          {/* Target account (sell only) */}
          {txType === 'sell' && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                Nakit hangi hesaba? (isteğe bağlı)
              </label>
              <select
                value={targetAccId}
                onChange={e => setTargetAccId(e.target.value)}
                className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">Hesap seçme — dış kaynak</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatCurrency(a.balance, a.currency)})
                  </option>
                ))}
              </select>
              {targetAccId && total > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatCurrency(total)} seçilen hesaba eklenecek.
                </div>
              )}
            </div>
          )}

          {/* Date */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Tarih</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent"
            />
          </div>

          {/* Note */}
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">Not (isteğe bağlı)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Açıklama ekle..."
              className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent"
            />
          </div>

          {/* Total */}
          {total > 0 && (
            <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-background border border-border text-sm">
              <span className="text-muted-foreground font-medium">Toplam</span>
              <span className="font-semibold text-foreground text-base tabular-nums">{formatCurrency(total)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40 ${txType === 'buy' ? 'bg-green-600 hover:bg-green-600/80' : 'bg-destructive hover:bg-destructive/80'}`}
          >
            {saving ? '...' : isEdit ? 'Kaydet' : txType === 'buy' ? 'Al' : 'Sat'}
          </button>
        </div>
      </div>
    </div>
  )
}
