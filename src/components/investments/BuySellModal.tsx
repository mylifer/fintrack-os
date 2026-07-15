'use client'

import { useState, useEffect } from 'react'
import { useInvestmentStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { SelectField } from '@/components/ui/Select'
import { isTefasAsset, tefasCode, tefasAsset, TEFAS_CODE_RE } from '@/lib/tefas'
import type { InvestmentAsset, InvestmentTransaction, TefasFundPrice } from '@/types'

// Varlık seçiminde 'TEFAS_NEW' sentinel'i: kod girilerek yeni fon eklenir
type AssetChoice = InvestmentAsset | 'TEFAS_NEW'

const ASSETS: { asset: InvestmentAsset; label: string; emoji: string; unit: string }[] = [
  { asset: 'GOLD_GRAM',    label: 'Gram Altın',       emoji: '🥇', unit: 'gr' },
  { asset: 'GOLD_QUARTER', label: 'Çeyrek Altın',     emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_HALF',    label: 'Yarım Altın',      emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_FULL',    label: 'Tam Altın',        emoji: '🥇', unit: 'adet' },
  { asset: 'GOLD_OZ',      label: 'Ons Altın',        emoji: '🥇', unit: 'oz' },
  { asset: 'GOLD_BRACELET', label: 'Bilezik (22 Ayar)', emoji: '💍', unit: 'gr' },
  { asset: 'USD',          label: 'ABD Doları',       emoji: '🇺🇸', unit: '$' },
  { asset: 'EUR',          label: 'Euro',             emoji: '🇪🇺', unit: '€' },
  { asset: 'GBP',          label: 'İngiliz Sterlini', emoji: '🇬🇧', unit: '£' },
]

// Gram altın karşılıkları — canlı Türkiye kotasyonu yoksa ve geçmiş tarihli
// alımlarda fiyat türetme için. Ziynetler 22 ayar: brüt gramaj × 0.916 milyem
const GOLD_GRAMS: Partial<Record<InvestmentAsset, number>> = {
  GOLD_GRAM: 1, GOLD_QUARTER: 1.6067, GOLD_HALF: 3.2133, GOLD_FULL: 6.4267, GOLD_OZ: 31.1035,
  GOLD_BRACELET: 0.916,
}

interface Props {
  open: boolean
  defaultType?: 'buy' | 'sell'
  editingTx?: InvestmentTransaction | null
  onClose: () => void
}

export function BuySellModal({ open, defaultType = 'buy', editingTx, onClose }: Props) {
  const addTransaction    = useInvestmentStore(s => s.addTransaction)
  const updateTransaction = useInvestmentStore(s => s.updateTransaction)
  const prices            = useInvestmentStore(s => s.prices)
  const fundPrices        = useInvestmentStore(s => s.fundPrices)
  const getHoldings       = useInvestmentStore(s => s.getHoldings)
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))

  const isEdit = !!editingTx

  const [txType,         setTxType]         = useState<'buy' | 'sell'>(defaultType)
  const [asset,          setAsset]          = useState<AssetChoice>('GOLD_GRAM')
  const [fundCode,       setFundCode]       = useState('')
  const [fundLookup,     setFundLookup]     = useState<
    { status: 'idle' | 'loading' | 'ok' | 'notfound' | 'error'; fund?: TefasFundPrice }
  >({ status: 'idle' })
  const [qty,            setQty]            = useState('')
  const [price,          setPrice]          = useState('')
  const [accountId,      setAccountId]      = useState('')   // buy: source account
  const [targetAccId,    setTargetAccId]    = useState('')   // sell: target account
  const [date,           setDate]           = useState(today())
  const [note,           setNote]           = useState('')
  const [saving,         setSaving]         = useState(false)
  const [fetchingPrice,  setFetchingPrice]  = useState(false)
  const [priceFetchFailed, setPriceFetchFailed] = useState(false)

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
    setFundCode('')
    setFundLookup({ status: 'idle' })
    // Önceki açılışta yarıda kesilen geçmiş-fiyat isteğinin göstergesi taşınmasın
    setFetchingPrice(false)
    setPriceFetchFailed(false)
  }, [open, editingTx, defaultType])

  // TEFAS fon kodu doğrulama — kod şekli oturunca debounce'la fiyat servisine sor
  useEffect(() => {
    if (!open || asset !== 'TEFAS_NEW') return
    const code = fundCode.trim().toUpperCase()
    if (!TEFAS_CODE_RE.test(code)) {
      setFundLookup({ status: 'idle' })
      return
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setFundLookup({ status: 'loading' })
      fetch(`/api/prices/tefas?codes=${code}`, { signal: ctrl.signal, cache: 'no-store' })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((d: { funds: Record<string, TefasFundPrice | null> }) => {
          const fund = d.funds?.[code]
          setFundLookup(fund ? { status: 'ok', fund } : { status: 'notfound' })
        })
        .catch(() => { if (!ctrl.signal.aborted) setFundLookup({ status: 'error' }) })
    }, 500)

    return () => { clearTimeout(timer); ctrl.abort() }
  }, [open, asset, fundCode])

  // 'TEFAS_NEW' → doğrulanmış koddan somut varlık; doğrulanmadıysa null (kaydedilemez)
  const resolvedAsset: InvestmentAsset | null =
    asset === 'TEFAS_NEW'
      ? (fundLookup.status === 'ok' && fundLookup.fund ? tefasAsset(fundLookup.fund.code) : null)
      : asset
  const isTefas = asset === 'TEFAS_NEW' || isTefasAsset(asset)

  function liveUnitPrice(a: AssetChoice): number {
    if (a === 'TEFAS_NEW') return fundLookup.fund?.price ?? 0
    if (isTefasAsset(a))   return fundPrices[tefasCode(a)]?.price ?? 0
    if (!prices) return 0
    // Ziynet altınları 22 ayar — önce Türkiye kuyum piyasası kotasyonu
    if (a === 'GOLD_QUARTER'  && prices.goldQuarterTry) return prices.goldQuarterTry
    if (a === 'GOLD_HALF'     && prices.goldHalfTry)    return prices.goldHalfTry
    if (a === 'GOLD_FULL'     && prices.goldFullTry)    return prices.goldFullTry
    if (a === 'GOLD_BRACELET' && prices.bilezikGramTry) return prices.bilezikGramTry
    if (a in GOLD_GRAMS)   return prices.goldGramTry * GOLD_GRAMS[a]!
    if (a === 'USD') return prices.usdTry
    if (a === 'EUR') return prices.eurTry
    if (a === 'GBP') return prices.gbpTry
    return 0
  }

  function fillLivePrice() {
    const p = liveUnitPrice(asset)
    if (p > 0) setPrice(isTefas ? p.toFixed(6) : p.toFixed(2))
  }

  // Auto-fill price when date or asset changes (new transactions only)
  useEffect(() => {
    if (!open || editingTx) return
    if (!date) return

    const todayStr = today()

    if (date >= todayStr) {
      // Yarıda kesilen geçmiş-fiyat isteğinin göstergesi takılı kalmasın
      // (abort edilen isteğin finally'si bayrağı sıfırlamaz)
      setFetchingPrice(false)
      setPriceFetchFailed(false)
      if (date === todayStr) {
        const p = liveUnitPrice(asset)
        if (p > 0) setPrice(isTefas ? p.toFixed(6) : p.toFixed(2))
      }
      return
    }

    const code = asset === 'TEFAS_NEW'
      ? fundLookup.fund?.code
      : isTefasAsset(asset) ? tefasCode(asset) : undefined
    if (isTefas && !code) return

    const group = isTefas ? 'TEFAS' : (asset in GOLD_GRAMS ? 'GOLD' : asset) as 'GOLD' | 'USD' | 'EUR' | 'GBP'
    const gramMult = GOLD_GRAMS[asset as InvestmentAsset] ?? 1

    const ctrl = new AbortController()
    setFetchingPrice(true)
    setPriceFetchFailed(false)

    const params = new URLSearchParams({ asset: group, from: date, buyDates: date })
    if (code) params.set('code', code)

    fetch(`/api/prices/history?${params}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((pts: { date: string; price: number }[]) => {
        // TEFAS'ta seçilen gün tatilse ilk sonraki işlem günü; kurlarda seri bugüne
        // kadar uzandığından son nokta en yakın değerdir
        const pt = pts.find(p => p.date === date) ?? (group === 'TEFAS' ? pts[0] : pts[pts.length - 1])
        if (pt) {
          const unitPrice = group === 'GOLD' ? pt.price * gramMult : pt.price
          setPrice(group === 'TEFAS' ? unitPrice.toFixed(6) : unitPrice.toFixed(2))
        } else {
          setPriceFetchFailed(true)
        }
      })
      .catch(() => { if (!ctrl.signal.aborted) setPriceFetchFailed(true) })
      // İptal edilen (eski) isteğin finally'si yeni isteğin göstergesini söndürmesin
      .finally(() => { if (!ctrl.signal.aborted) setFetchingPrice(false) })

    return () => ctrl.abort()
  }, [open, date, asset, editingTx, prices, fundLookup])

  const qtyNum    = parseFloat(qty)   || 0
  const priceNum  = parseFloat(price) || 0
  const total     = qtyNum * priceNum

  // Asset choices — statik varlıklar + portföydeki TEFAS fonları (+ alımda yeni fon)
  const holdings = getHoldings()

  const tefasChoices: { asset: AssetChoice; label: string; emoji: string; unit: string }[] = [
    ...holdings
      .filter(h => isTefasAsset(h.asset) && h.quantity > 0.000001)
      .map(h => ({
        asset: h.asset as AssetChoice,
        label: `${tefasCode(h.asset)} — TEFAS Fonu`,
        emoji: '📊', unit: 'pay',
      })),
    // Düzenlenen işlem tamamen satılmış bir fona aitse seçenek listesinde yine görünsün
    ...(isEdit && editingTx && isTefasAsset(editingTx.asset) &&
        !holdings.some(h => h.asset === editingTx.asset && h.quantity > 0.000001)
      ? [{ asset: editingTx.asset as AssetChoice, label: `${tefasCode(editingTx.asset)} — TEFAS Fonu`, emoji: '📊', unit: 'pay' }]
      : []),
  ]

  const sellableAssets  = [
    ...ASSETS.filter(a => holdings.some(h => h.asset === a.asset && h.quantity > 0.000001)),
    ...tefasChoices,
  ]
  const buyableAssets   = [
    ...ASSETS,
    ...tefasChoices,
    { asset: 'TEFAS_NEW' as AssetChoice, label: 'TEFAS Fonu (kodla ekle)', emoji: '📊', unit: 'pay' },
  ]
  const visibleAssets   = txType === 'sell' && !isEdit ? sellableAssets : buyableAssets
  const assetMeta       =
    visibleAssets.find(a => a.asset === asset)
    ?? ASSETS.find(a => a.asset === asset)
    ?? { asset, label: 'TEFAS Fonu', emoji: '📊', unit: 'pay' }
  const currentHolding  = resolvedAsset ? holdings.find(h => h.asset === resolvedAsset) : undefined
  const heldQty         = currentHolding?.quantity ?? 0
  const editOffset      = isEdit && editingTx?.type === 'sell' ? editingTx.quantity : 0
  const maxSell         = txType === 'sell'
    ? heldQty + (isEdit && txType === editingTx?.type ? editOffset : 0)
    : Infinity
  const sellExceeded = txType === 'sell' && qtyNum > maxSell

  const canSave = qtyNum > 0 && priceNum > 0 && !!date && !sellExceeded && !saving && resolvedAsset !== null

  async function handleSave() {
    if (!canSave || !resolvedAsset) return
    setSaving(true)
    try {
    if (isEdit && editingTx) {
      await updateTransaction(editingTx.id, {
        type:            txType,
        asset:           resolvedAsset,
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
        asset:           resolvedAsset,
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
    onClose()
    } catch (err) {
      console.error('[investment:save]', err)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* max-h + scroll: TEFAS kod alanı açıkken kısa ekranlarda footer taşmasın */}
      <div className="w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-y-auto max-h-[calc(100dvh-2rem)] border border-border">

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
            <SelectField
              value={asset}
              onChange={e => {
                const next = e.target.value as AssetChoice
                setAsset(next)
                setPrice('')
                if (next !== 'TEFAS_NEW') { setFundCode(''); setFundLookup({ status: 'idle' }) }
              }}
              options={visibleAssets.map(a => ({ value: a.asset, label: `${a.emoji} ${a.label}` }))}
              className="h-10 bg-background"
            />
          </div>

          {/* TEFAS fund code (new fund only) */}
          {asset === 'TEFAS_NEW' && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                Fon Kodu
              </label>
              <input
                type="text"
                value={fundCode}
                onChange={e => setFundCode(e.target.value.toUpperCase())}
                placeholder="Örn. AFA, YAC, TI2"
                maxLength={6}
                autoFocus
                className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground uppercase tracking-widest focus:outline-none focus:border-accent"
              />
              {fundLookup.status === 'loading' && (
                <div className="mt-1 text-xs text-muted-foreground animate-pulse">Fon aranıyor...</div>
              )}
              {fundLookup.status === 'ok' && fundLookup.fund && (
                <div className="mt-1 text-xs text-green-600 font-medium">
                  ✓ {fundLookup.fund.name}
                  <span className="text-muted-foreground font-normal">
                    {' '}· ₺{fundLookup.fund.price.toLocaleString('tr-TR', { maximumFractionDigits: 6 })} ({fundLookup.fund.date})
                  </span>
                </div>
              )}
              {fundLookup.status === 'notfound' && (
                <div className="mt-1 text-xs text-destructive font-medium">Bu kodla bir fon bulunamadı.</div>
              )}
              {fundLookup.status === 'error' && (
                <div className="mt-1 text-xs text-destructive font-medium">TEFAS&apos;a ulaşılamadı, tekrar deneyin.</div>
              )}
            </div>
          )}

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
              ) : liveUnitPrice(asset) > 0 && (
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
                onChange={e => { setPrice(e.target.value); setPriceFetchFailed(false) }}
                placeholder="0.00"
                min={0}
                step="any"
                disabled={fetchingPrice}
                className="w-full text-sm border border-border rounded-xl pl-7 pr-3 h-10 bg-background text-foreground focus:outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
            {priceFetchFailed && !fetchingPrice && (
              <div className="mt-1 text-xs text-destructive font-medium">
                Seçilen tarihin fiyatı alınamadı — fiyatı elle girebilirsiniz.
              </div>
            )}
          </div>

          {/* Source account (buy only) */}
          {txType === 'buy' && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                Hangi hesaptan? (isteğe bağlı)
              </label>
              <SelectField
                value={accountId}
                onChange={e => setAccountId(e.target.value)}
                options={[
                  { value: '', label: 'Hesap seçme — dış kaynak' },
                  ...accounts.map(a => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance, a.currency)})` })),
                ]}
                className="h-10 bg-background"
              />
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
              <SelectField
                value={targetAccId}
                onChange={e => setTargetAccId(e.target.value)}
                options={[
                  { value: '', label: 'Hesap seçme — dış kaynak' },
                  ...accounts.map(a => ({ value: a.id, label: `${a.name} (${formatCurrency(a.balance, a.currency)})` })),
                ]}
                className="h-10 bg-background"
              />
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
