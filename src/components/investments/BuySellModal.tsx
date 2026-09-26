'use client'

import { useState, useEffect, useRef } from 'react'
import { useInvestmentStore, useAccountStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { SelectField } from '@/components/ui/Select'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { isTefasAsset, tefasCode, tefasAsset, TEFAS_CODE_RE } from '@/lib/tefas'
import {
  isMarketAsset, marketKind, marketSymbol, marketAsset, isValidMarketSymbol, MARKET_KIND_META, type MarketKind,
} from '@/lib/market'
import { useFundTaxConfig } from '@/store/settings.store'
import { fundTaxRate, taxOnGain, fmtRate } from '@/lib/utils/fund-tax'
import { avgCostAt } from '@/lib/utils/investment-returns'
import type { InvestmentAsset, InvestmentTransaction, TefasFundPrice } from '@/types'

// Varlık seçiminde '*_NEW' sentinel'leri: kod girilerek yeni fon / hisse /
// kripto eklenir. BES fonları da TEFAS'ta kodla listelenir (örn. AZS, GEA).
type NewKind = 'TEFAS' | MarketKind
type AssetChoice = InvestmentAsset | 'TEFAS_NEW' | 'BIST_NEW' | 'CRYPTO_NEW'

const NEW_KIND: Partial<Record<AssetChoice, NewKind>> = {
  TEFAS_NEW: 'TEFAS', BIST_NEW: 'BIST', CRYPTO_NEW: 'CRYPTO',
}

const LOOKUP_TEXT: Record<NewKind, { label: string; placeholder: string; maxLength: number; notFound: string; error: string }> = {
  TEFAS:  { label: 'Fon Kodu',     placeholder: 'Örn. AFA, YAC · BES: AZS, GEA', maxLength: 6,  notFound: 'Bu kodla bir fon bulunamadı.',   error: 'TEFAS\'a ulaşılamadı, tekrar deneyin.' },
  BIST:   { label: 'Hisse Kodu',   placeholder: MARKET_KIND_META.BIST.hint,       maxLength: 6,  notFound: 'Bu kodla bir hisse bulunamadı.', error: 'Fiyat servisine ulaşılamadı, tekrar deneyin.' },
  CRYPTO: { label: 'Kripto Sembolü', placeholder: MARKET_KIND_META.CRYPTO.hint,   maxLength: 10, notFound: 'Bu sembolle bir kripto bulunamadı.', error: 'Fiyat servisine ulaşılamadı, tekrar deneyin.' },
}

function isLookupCode(kind: NewKind, code: string): boolean {
  return kind === 'TEFAS' ? TEFAS_CODE_RE.test(code) : isValidMarketSymbol(kind, code)
}

async function lookupQuote(kind: NewKind, code: string, signal: AbortSignal): Promise<TefasFundPrice | null> {
  if (kind === 'TEFAS') {
    const r = await fetch(`/api/prices/tefas?codes=${code}`, { signal, cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    const d: { funds: Record<string, TefasFundPrice | null> } = await r.json()
    return d.funds?.[code] ?? null
  }
  const key = marketAsset(kind, code)
  const r = await fetch(`/api/prices/market?assets=${key}`, { signal, cache: 'no-store' })
  if (!r.ok) throw new Error(String(r.status))
  const d: { quotes: Record<string, TefasFundPrice | null> } = await r.json()
  return d.quotes?.[key] ?? null
}

function marketChoiceLabel(a: InvestmentAsset): { label: string; emoji: string; unit: string } {
  const kind = isMarketAsset(a) ? marketKind(a) : 'BIST'
  return {
    label: `${marketSymbol(a)} — ${MARKET_KIND_META[kind].label}`,
    emoji: kind === 'BIST' ? '📈' : '🪙',
    unit:  kind === 'CRYPTO' ? marketSymbol(a) : MARKET_KIND_META[kind].unit,
  }
}

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

// Toplam maliyetten birim fiyat türetme. Taban 6 ondalık (TEFAS pay fiyatı
// kotasyonu); pay sayısı çok büyükse 6 ondalık toplamı kuruşun ötesinde
// kaydırabildiği için gerektiği kadar ondalık eklenir. Number() kuyruktaki
// sıfırları ve float gürültüsünü atar.
function derivePrice(total: number, quantity: number): string {
  for (let d = 6; d < 12; d++) {
    const rounded = Number((total / quantity).toFixed(d))
    if (Math.abs(rounded * quantity - total) < 0.005) return String(rounded)
  }
  return String(Number((total / quantity).toFixed(12)))
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
  const investTxs         = useInvestmentStore(s => s.transactions)
  const accounts = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const fundTax  = useFundTaxConfig()

  const isEdit = !!editingTx

  const [txType,         setTxType]         = useState<'buy' | 'sell'>(defaultType)
  const [asset,          setAsset]          = useState<AssetChoice>('GOLD_GRAM')
  const [fundCode,       setFundCode]       = useState('')
  const [fundLookup,     setFundLookup]     = useState<
    { status: 'idle' | 'loading' | 'ok' | 'notfound' | 'error'; fund?: TefasFundPrice }
  >({ status: 'idle' })
  const [qty,            setQty]            = useState('')
  const [price,          setPrice]          = useState('')
  // Kullanıcının ELLE girdiği toplam maliyet. Boşken toplam pay × birim
  // fiyattan hesaplanır; doluyken birim fiyat bu toplamdan türetilir.
  const [totalDraft,     setTotalDraft]     = useState('')
  const [accountId,      setAccountId]      = useState('')   // buy: source account
  const [targetAccId,    setTargetAccId]    = useState('')   // sell: target account
  const [date,           setDate]           = useState(today())
  const [note,           setNote]           = useState('')
  const [saving,         setSaving]         = useState(false)
  const [fetchingPrice,  setFetchingPrice]  = useState(false)
  const [priceFetchFailed, setPriceFetchFailed] = useState(false)
  // Kullanıcının birim fiyatı ELLE girdiği (varlık|tarih) kombinasyonu.
  // Otomatik doldurma bu anahtar güncelken alana DOKUNMAZ.
  //
  // Neden gerekli: yatırımlar ve dashboard sayfaları fiyatları 60 sn'de bir
  // tazeliyor (investments/page.tsx:88) ve modal o sayfadan açıldığı için
  // interval çalışmaya devam ediyor. `prices` doldurma efektinin bağımlılığı
  // olduğundan, kullanıcı gerçek alım fiyatını yazıp diğer alanları doldururken
  // efekt yeniden koşuyor ve fiyatı sessizce canlı fiyata geri çeviriyordu —
  // sonuçta YANLIŞ birim fiyatla kayıt oluşuyordu.
  //
  // Neden state değil ref: anahtarı state ile tutup ayrı bir efektle sıfırlamak,
  // tarih değiştiğinde sıfırlama efektinin doldurma efektinden ÖNCE çalışmasına
  // ama doldurma efektinin hâlâ ESKİ değeri okumasına yol açardı; deps o render'da
  // değişmediği için doldurma bir daha koşmaz ve alan hiç dolmazdı. Ref anında
  // güncellenir, bu sıralama sorununu tamamen ortadan kaldırır.
  const touchedPriceKey = useRef<string | null>(null)
  const priceKey = `${asset}|${date}`

  // Populate form when modal opens
  useEffect(() => {
    if (!open) return
    if (editingTx) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bilinçli: açılış anında formu doldurur; fiyat doldurma effect'iyle ref sıralaması (touchedPriceKey, yukarıdaki not) bu yapıya dayanıyor — render-içi kalıba taşımak o sırayı bozar
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
    setTotalDraft('')
    touchedPriceKey.current = null
  }, [open, editingTx, defaultType, getHoldings])

  // Yeni fon / hisse / kripto kodu doğrulama — kod şekli oturunca debounce'la fiyat servisine sor
  const newKind = NEW_KIND[asset] ?? null
  useEffect(() => {
    if (!open || !newKind) return
    const code = fundCode.trim().toUpperCase()
    if (!isLookupCode(newKind, code)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bilinçli: kod bozulunca ÖNCEKİ kodun 'ok' sonucu hemen düşmeli; türetilmiş bir değer, yeni kod doğrulanana kadar eski fonu kaydettirebilirdi
      setFundLookup({ status: 'idle' })
      return
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setFundLookup({ status: 'loading' })
      lookupQuote(newKind, code, ctrl.signal)
        .then(fund => setFundLookup(fund ? { status: 'ok', fund } : { status: 'notfound' }))
        .catch(() => { if (!ctrl.signal.aborted) setFundLookup({ status: 'error' }) })
    }, 500)

    return () => { clearTimeout(timer); ctrl.abort() }
  }, [open, newKind, fundCode])

  // '*_NEW' → doğrulanmış koddan somut varlık; doğrulanmadıysa null (kaydedilemez)
  const lookedUp = fundLookup.status === 'ok' && fundLookup.fund ? fundLookup.fund.code : null
  const resolvedAsset: InvestmentAsset | null =
    !newKind ? (asset as InvestmentAsset)
    : !lookedUp ? null
    : newKind === 'TEFAS' ? tefasAsset(lookedUp)
    : marketAsset(newKind, lookedUp)
  const isTefas  = newKind === 'TEFAS' || isTefasAsset(asset)
  const isMarket = newKind === 'BIST' || newKind === 'CRYPTO' || isMarketAsset(asset)
  // Fon payı ve kripto fiyatı küsuratlı (6 hane); diğerleri kuruş
  const priceDecimals = isTefas || newKind === 'CRYPTO' || (isMarketAsset(asset) && marketKind(asset) === 'CRYPTO') ? 6 : 2

  function liveUnitPrice(a: AssetChoice): number {
    if (NEW_KIND[a])       return fundLookup.fund?.price ?? 0
    if (isTefasAsset(a))   return fundPrices[tefasCode(a)]?.price ?? 0
    if (isMarketAsset(a))  return fundPrices[a]?.price ?? 0
    if (!prices) return 0
    // Ziynet altınları 22 ayar — önce Türkiye kuyum piyasası kotasyonu
    if (a === 'GOLD_QUARTER'  && prices.goldQuarterTry) return prices.goldQuarterTry
    if (a === 'GOLD_HALF'     && prices.goldHalfTry)    return prices.goldHalfTry
    if (a === 'GOLD_FULL'     && prices.goldFullTry)    return prices.goldFullTry
    if (a === 'GOLD_BRACELET' && prices.bilezikGramTry) return prices.bilezikGramTry
    if (a in GOLD_GRAMS)   return prices.goldGramTry * GOLD_GRAMS[a as InvestmentAsset]!
    if (a === 'USD') return prices.usdTry
    if (a === 'EUR') return prices.eurTry
    if (a === 'GBP') return prices.gbpTry
    return 0
  }

  function fillLivePrice() {
    const p = liveUnitPrice(asset)
    if (p > 0) {
      setPrice(p.toFixed(priceDecimals))
      setTotalDraft('')
    }
  }

  // Auto-fill price when date or asset changes (new transactions only)
  useEffect(() => {
    if (!open || editingTx) return
    if (!date) return
    // Kullanıcı bu varlık+tarih için fiyatı elle girdiyse üzerine yazma.
    // (Varlık ya da tarih değişince anahtar tutmaz ve doldurma yine çalışır.)
    if (touchedPriceKey.current === priceKey) return
    // Toplam maliyet elle girildiyse birim fiyat ondan türetilir; tarih
    // değişse bile canlı/geçmiş fiyat bu türetilmiş fiyatı ezmemeli
    // (ezerse toplam ile pay × birim fiyat birbirini tutmaz).
    if (totalDraft.trim() !== '') return

    const todayStr = today()

    if (date >= todayStr) {
      // Yarıda kesilen geçmiş-fiyat isteğinin göstergesi takılı kalmasın
      // (abort edilen isteğin finally'si bayrağı sıfırlamaz)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- bilinçli: iptal edilen isteğin yaşam döngüsü bayraklarını kapatır (dış sistemle eşitleme)
      setFetchingPrice(false)
      setPriceFetchFailed(false)
      if (date === todayStr) {
        const p = liveUnitPrice(asset)
        if (p > 0) setPrice(p.toFixed(priceDecimals))
      }
      return
    }

    // Geçmiş seri anahtarı: TEFAS'ta fon kodu, hisse/kriptoda tam varlık ('BIST:THYAO')
    const code = isTefas
      ? (newKind ? fundLookup.fund?.code : tefasCode(asset as InvestmentAsset))
      : isMarket ? (resolvedAsset ?? undefined) : undefined
    if ((isTefas || isMarket) && !code) return

    const group = isTefas ? 'TEFAS' : isMarket ? 'MARKET'
      : (asset in GOLD_GRAMS ? 'GOLD' : asset) as 'GOLD' | 'USD' | 'EUR' | 'GBP'
    const gramMult = GOLD_GRAMS[asset as InvestmentAsset] ?? 1

    const ctrl = new AbortController()
    setFetchingPrice(true)
    setPriceFetchFailed(false)

    const params = new URLSearchParams({ asset: group, from: date, buyDates: date })
    if (code) params.set('code', code)

    fetch(`/api/prices/history?${params}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((pts: { date: string; price: number }[]) => {
        // TEFAS/borsada seçilen gün tatilse ilk sonraki işlem günü; kurlarda seri
        // bugüne kadar uzandığından son nokta en yakın değerdir
        const pt = pts.find(p => p.date === date) ?? (group === 'TEFAS' || group === 'MARKET' ? pts[0] : pts[pts.length - 1])
        if (pt) {
          const unitPrice = group === 'GOLD' ? pt.price * gramMult : pt.price
          setPrice(unitPrice.toFixed(priceDecimals))
        } else {
          setPriceFetchFailed(true)
        }
      })
      .catch(() => { if (!ctrl.signal.aborted) setPriceFetchFailed(true) })
      // İptal edilen (eski) isteğin finally'si yeni isteğin göstergesini söndürmesin
      .finally(() => { if (!ctrl.signal.aborted) setFetchingPrice(false) })

    return () => ctrl.abort()
  // Türetilmiş değerler (isTefas, isMarket, newKind, resolvedAsset, priceDecimals,
  // liveUnitPrice) asset + fundLookup'tan hesaplanır ve her render yeniden
  // oluşur; onları eklemek efekti her render'da yeniden koşturur (fetch döngüsü).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, asset, editingTx, prices, fundLookup, priceKey, totalDraft])

  const qtyNum    = parseFloat(qty)   || 0
  const priceNum  = parseFloat(price) || 0
  const total     = qtyNum * priceNum
  const totalAnchored = totalDraft.trim() !== ''

  // Toplam ↔ pay ↔ birim fiyat üçlüsü: iki alan biliniyorsa üçüncüsü yazılır.
  // Toplam ile pay girilmişse birim fiyat hesaplanır (TEFAS'ta gerçek akış:
  // "₺5.000 ödedim, 123,456 pay aldım" → pay fiyatı).
  function applyQty(value: string) {
    setQty(value)
    const q = parseFloat(value) || 0
    const t = parseFloat(totalDraft) || 0
    if (t > 0 && q > 0) {
      setPrice(derivePrice(t, q))
      setPriceFetchFailed(false)
      touchedPriceKey.current = priceKey
    }
  }

  function applyTotal(value: string) {
    setTotalDraft(value)
    const t = parseFloat(value) || 0
    if (t > 0 && qtyNum > 0) {
      setPrice(derivePrice(t, qtyNum))
      setPriceFetchFailed(false)
      touchedPriceKey.current = priceKey
    }
  }

  // Birim fiyat elle yazılınca toplam yeniden türetilen alan olur
  function applyPrice(value: string) {
    setPrice(value)
    setPriceFetchFailed(false)
    setTotalDraft('')
    touchedPriceKey.current = priceKey
  }

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

  // Portföydeki hisse/kripto (+ düzenlenen işlemin tamamen satılmış varlığı)
  const marketChoices: { asset: AssetChoice; label: string; emoji: string; unit: string }[] = [
    ...holdings.filter(h => isMarketAsset(h.asset) && h.quantity > 0.000001).map(h => h.asset),
    ...(isEdit && editingTx && isMarketAsset(editingTx.asset) &&
        !holdings.some(h => h.asset === editingTx.asset && h.quantity > 0.000001)
      ? [editingTx.asset] : []),
  ].map(a => ({ asset: a as AssetChoice, ...marketChoiceLabel(a) }))

  const sellableAssets  = [
    ...ASSETS.filter(a => holdings.some(h => h.asset === a.asset && h.quantity > 0.000001)),
    ...tefasChoices,
    ...marketChoices,
  ]
  const buyableAssets   = [
    ...ASSETS,
    ...tefasChoices,
    ...marketChoices,
    { asset: 'TEFAS_NEW'  as AssetChoice, label: 'TEFAS / BES Fonu (kodla ekle)', emoji: '📊', unit: 'pay' },
    { asset: 'BIST_NEW'   as AssetChoice, label: 'BIST Hissesi (kodla ekle)',     emoji: '📈', unit: 'adet' },
    { asset: 'CRYPTO_NEW' as AssetChoice, label: 'Kripto (sembolle ekle)',        emoji: '🪙', unit: 'birim' },
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

  /* Satış önizlemesi — kaydedilecek defter satırlarının aynısı hesaplanır
     (investment.store/createSellLinkedTxs ile AYNI formül): ortalama maliyet
     üzerinden gerçekleşen kâr, sonra kâr üzerinden stopaj. Ayar kapalıysa ya
     da fon TEFAS değilse oran 0 → blok hiç görünmez. */
  const sellRate     = txType === 'sell' && resolvedAsset ? fundTaxRate(resolvedAsset, fundTax) : 0
  // Store ile aynı: satış tarihindeki ortalama maliyet (geriye tarihli satışta
  // sonraki alımlar sayılmaz). Yeni kayıt şimdi oluşturulmuş sayılır — store da öyle yazar.
  const sellAvg      = txType === 'sell' && resolvedAsset
    ? avgCostAt(investTxs, resolvedAsset, { date, createdAt: editingTx?.createdAt ?? new Date().toISOString() }, editingTx?.id)
    : 0
  const sellCost     = qtyNum * sellAvg
  const sellGain     = sellCost > 0.001 ? total - sellCost : 0
  const sellTax      = taxOnGain(sellGain, sellRate)
  const showSellTax  = !sellExceeded && sellRate > 0 && total > 0 && sellCost > 0.001

  // Geçmiş tarihin fiyatı yüklenirken kaydetmek, alanda kalan ESKİ (canlı)
  // fiyatla kayıt açardı — yükleme bitene kadar kaydetme kapalı.
  const canSave = qtyNum > 0 && priceNum > 0 && !!date && !sellExceeded && !saving && !fetchingPrice && resolvedAsset !== null

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

  // Radix Dialog: role="dialog" + aria-modal, odak tuzağı, Esc ile kapanma,
  // kapanınca odağın açan düğmeye dönmesi (eskiden elle yazılmış katmanda yoktu).
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      {/* max-h + scroll: TEFAS kod alanı açıkken kısa ekranlarda footer taşmasın */}
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 p-0 bg-card rounded-2xl shadow-2xl overflow-y-auto max-h-[calc(100dvh-2rem)] sm:max-w-md block"
      >

        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex items-center justify-between">
          <DialogTitle className="text-base font-semibold text-foreground">
            {isEdit ? 'İşlemi Düzenle' : 'Yatırım İşlemi'}
          </DialogTitle>
          <DialogClose
            aria-label="Kapat"
            className="w-7 h-7 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >✕</DialogClose>
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
                setTotalDraft('')
                touchedPriceKey.current = null
                // Kod alanı her seçimde sıfırlanır: THYAO yazılıp kriptoya geçilirse eski sonuç kalmasın
                setFundCode(''); setFundLookup({ status: 'idle' })
              }}
              options={visibleAssets.map(a => ({ value: a.asset, label: `${a.emoji} ${a.label}` }))}
              className="h-10 bg-background"
            />
          </div>

          {/* Yeni fon / hisse / kripto kodu */}
          {newKind && (
            <div>
              <label htmlFor="new-asset-code" className="text-xs font-medium uppercase tracking-wide text-muted-foreground block mb-1.5">
                {LOOKUP_TEXT[newKind].label}
              </label>
              <input
                type="text"
                value={fundCode}
                onChange={e => setFundCode(e.target.value.toUpperCase())}
                id="new-asset-code"
                placeholder={LOOKUP_TEXT[newKind].placeholder}
                maxLength={LOOKUP_TEXT[newKind].maxLength}
                autoFocus
                className="w-full text-sm border border-border rounded-xl px-3 h-10 bg-background text-foreground uppercase tracking-widest focus:outline-none focus:border-accent"
              />
              {fundLookup.status === 'loading' && (
                <div className="mt-1 text-xs text-muted-foreground animate-pulse">Aranıyor...</div>
              )}
              {fundLookup.status === 'ok' && fundLookup.fund && (
                <div className="mt-1 text-xs text-green-600 font-medium">
                  ✓ {fundLookup.fund.name}
                  <span className="text-muted-foreground font-normal">
                    {' '}· ₺{fundLookup.fund.price.toLocaleString('tr-TR', { maximumFractionDigits: fundLookup.fund.price >= 100 ? 2 : 6 })} ({fundLookup.fund.date})
                  </span>
                </div>
              )}
              {fundLookup.status === 'notfound' && (
                <div className="mt-1 text-xs text-destructive font-medium">{LOOKUP_TEXT[newKind].notFound}</div>
              )}
              {fundLookup.status === 'error' && (
                <div className="mt-1 text-xs text-destructive font-medium">{LOOKUP_TEXT[newKind].error}</div>
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
                  onClick={() => setQty(maxSell % 1 === 0 ? String(maxSell) : maxSell.toFixed(8).replace(/\.?0+$/, ''))}
                  className="text-xs text-primary font-semibold hover:text-primary/80 transition-colors"
                >
                  Tümünü sat ({maxSell.toLocaleString('tr-TR', { maximumFractionDigits: 8 })} {assetMeta.unit})
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                value={qty}
                onChange={e => applyQty(e.target.value)}
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
                Portföyde: {maxSell.toLocaleString('tr-TR', { maximumFractionDigits: 8 })} {assetMeta.unit}
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
                onChange={e => applyPrice(e.target.value)}
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

          {/* Total — eski özet satırının görünümü, değeri yazılabilir:
              toplam girilip pay da doluysa birim fiyat buradan türetilir */}
          <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-background border border-border text-sm focus-within:border-accent transition-colors">
            <span className="text-muted-foreground font-medium">Toplam</span>
            <div className="flex items-center gap-0.5 font-semibold text-foreground text-base">
              <span>₺</span>
              <input
                type="number"
                value={totalAnchored ? totalDraft : total > 0 ? String(Number(total.toFixed(2))) : ''}
                onChange={e => applyTotal(e.target.value)}
                placeholder="0,00"
                min={0}
                step="any"
                disabled={fetchingPrice}
                aria-label="Toplam"
                // Çerçevesiz hücrede artır/azalt okları sayıyı hover'da kaydırıyor — gizle
                className="w-32 bg-transparent border-0 p-0 text-right text-base font-semibold tabular-nums text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Stopaj önizlemesi — yalnız TEFAS satışında ve ayar açıkken.
              Kaydet'e basılınca burada yazan tutar ayrı bir gider satırı olur. */}
          {showSellTax && (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Gerçekleşen kâr</span>
                <span className={`tabular-nums font-medium ${sellGain >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {(sellGain >= 0 ? '+' : '−') + formatCurrency(Math.abs(sellGain))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Stopaj ({fmtRate(sellRate)})</span>
                <span className="tabular-nums font-medium text-destructive">
                  {sellTax > 0 ? '−' + formatCurrency(sellTax) : formatCurrency(0)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-1 mt-0.5">
                <span className="text-foreground font-medium">Hesaba net kalan</span>
                <span className="tabular-nums font-semibold text-foreground">
                  {formatCurrency(total - sellTax)}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {sellTax > 0
                  ? 'Kesinti ayrı bir "Satış Stopajı" gideri olarak Vergi kategorisine yazılır.'
                  : 'Kâr olmadığı için kesinti yazılmaz.'}
              </div>
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
      </DialogContent>
    </Dialog>
  )
}
