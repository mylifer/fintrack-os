'use client'

import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { useShallow } from 'zustand/react/shallow'
import {
  format, parseISO, startOfMonth, endOfMonth,
  subMonths, subDays, startOfYear, endOfYear,
  differenceInDays, addMonths, addDays,
  startOfWeek, endOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header }           from '@/components/layout/Header'
import { useTransactionStore, useAccountStore, useCategoryStore, useInvestmentStore, useSettingsStore } from '@/store'
import { getAssetPrice, computeHoldings } from '@/store/investment.store'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { SelectField } from '@/components/ui/Select'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { normalizeTag, tagKey, tagColor } from '@/lib/utils/tags'
import { isReconciliation } from '@/lib/utils/reconciliation'
import { excludeFuture, calcNetWorth, calcNetRaw, calcPeriodFlow, sumExpenseByKey, sumIncomeByKey, isRealizedInvestmentPnlTx } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'
import { buildCashFlowData } from '@/lib/utils/cashflow'
import { baseAmount, fromBaseTry } from '@/lib/utils/fx'
import { toMinor, toMajor, sumBy } from '@/lib/utils/money'
import { calcFundPeriodGain, type FundPricePoint } from '@/lib/utils/fund-period-gain'
import { tefasCodesIn } from '@/lib/tefas'
import { CashFlowBarChart }   from '@/components/reports/CashFlowBarChart'
import { CashFlowDetailOverlay } from '@/components/reports/CashFlowDetailOverlay'
import { CategoryDonutChart }  from '@/components/reports/CategoryDonutChart'
import { BalanceTrendChart }   from '@/components/reports/BalanceTrendChart'
import { CategoryTrendChart }  from '@/components/reports/CategoryTrendChart'
import { TransactionList }     from '@/components/transactions/TransactionList'
import { ListFilter, BarChart3, LineChart as LineChartIcon } from 'lucide-react'
import type { CategorySlice }       from '@/components/reports/_CategoryDonutChart'
import type { TrendPoint }          from '@/components/reports/_BalanceTrendChart'
import type { CategoryTrendPoint }  from '@/components/reports/_CategoryTrendChart'
import type { Account, Transaction, PriceData, InvestmentTransaction, TefasFundPrice } from '@/types'

/* ── Types ────────────────────────────────────────────────────────── */

type Preset = 'today' | 'this-week' | 'this-month' | 'last-month' | '3-months' | 'this-year' | 'all-time' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today',      label: 'Bugün' },
  { key: 'this-week',  label: 'Bu Hafta' },
  { key: 'this-month', label: 'Bu Ay' },
  { key: 'last-month', label: 'Geçen Ay' },
  { key: '3-months',   label: 'Son 3 Ay' },
  { key: 'this-year',  label: 'Bu Yıl' },
  { key: 'all-time',   label: 'Tüm Zamanlar' },
  { key: 'custom',     label: 'Özel' },
]

/* ── Data helpers ─────────────────────────────────────────────────── */

function getPresetRange(preset: Preset, customFrom: string, customTo: string) {
  const now = new Date()
  switch (preset) {
    case 'today': {
      const t = format(now, 'yyyy-MM-dd')
      return { from: t, to: t }
    }
    case 'this-week':
      return {
        from: format(startOfWeek(now, { locale: tr }), 'yyyy-MM-dd'),
        to:   format(endOfWeek(now,   { locale: tr }), 'yyyy-MM-dd'),
      }
    case 'this-month':
      return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') }
    case 'last-month': {
      const lm = subMonths(now, 1)
      return { from: format(startOfMonth(lm), 'yyyy-MM-dd'), to: format(endOfMonth(lm), 'yyyy-MM-dd') }
    }
    case '3-months':
      return {
        from: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'),
        to:   format(endOfMonth(now), 'yyyy-MM-dd'),
      }
    case 'this-year':
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'all-time':
      // Gerçek aralık işlemlerden hesaplanır (bkz. dateRange useMemo); burada
      // yalnızca işlem yokken kullanılan güvenli varsayılan.
      return { from: format(startOfYear(now), 'yyyy-MM-dd'), to: format(endOfYear(now), 'yyyy-MM-dd') }
    case 'custom':
      return {
        from: customFrom || format(startOfMonth(now), 'yyyy-MM-dd'),
        to:   customTo   || format(endOfMonth(now),   'yyyy-MM-dd'),
      }
  }
}

function buildCategoryData(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
  type: 'expense' | 'income' = 'expense',
): CategorySlice[] {
  // TRY-normalize + kuruş-exact, skip investment-linked (icon) & reconciliation
  // ghosts — DetailedStats ve kategori 6-ay trendiyle aynı kural (tek kaynak).
  // Gelir tarafı aynı kuralı sumIncomeByKey ile paylaşır (yatırım satır dışlaması
  // dahil), böylece iki donut birbirine simetrik okunur.
  const catMap = type === 'income'
    ? sumIncomeByKey(transactions,  tx => tx.categoryId ?? '__none__')
    : sumExpenseByKey(transactions, tx => tx.categoryId ?? '__none__')
  // A category whose *net* total is ≤ 0 — fully refunded, or carrying only a
  // refund (negative expense) for a purchase made in an earlier period — is not
  // a positive expense contribution. Drop it before building slices: a negative
  // dataKey makes Recharts' <Pie> draw a reversed/overlapping arc and yields
  // nonsensical percentages (negative, or >100% for the remaining slices).
  const entries = [...catMap.entries()].filter(([, amount]) => amount > 0)
  const total = entries.reduce((s, [, amount]) => s + amount, 0)
  if (total === 0) return []
  return entries
    .map(([key, amount]) => {
      const cat        = categories.find(c => c.id === key)
      const categoryId = key === '__none__' ? null : key
      return { categoryId, name: cat?.name ?? 'Kategorisiz', amount, percent: (amount / total) * 100, color: cat?.color ?? '#8C8C8C' }
    })
    .sort((a, b) => b.amount - a.amount)
}

/* ── Income distribution + fon getirisi dilimi ─────────────────────────
   "Fon getirileri dahil" anahtarı AÇIKKEN fon getirisi gelir donut'unda da tek
   bir dilim olarak görünür — Toplam Gelir KPI'ı ile AYNI iki bileşenden:
     (1) defterdeki GERÇEKLEŞEN "… Satış Kârı" gelir satırları. Bunlar icon'lu
         olduğundan sumIncomeByKey onları atlar (dağılım kuralı), bu yüzden
         burada ayrıca toplanır.
     (2) GERÇEKLEŞMEMİŞ dönem fon getirisi (mark-to-market) — defterde satırı
         yoktur, çağıran hesaplar (fundGain, pozitif-kapılı).
   Anahtar KAPALIYKEN ikisi de 0: realize satırlar filteredTxs'te zaten
   ayıklanmıştır, fundGain 0 gelir → donut yalnız kategorili gelirleri gösterir.
   Anapara ("… Satışı") HİÇBİR durumda girmez — özsermaye geri dönüşü, gelir değil.
 ──────────────────────────────────────────────────────────────────────── */

const FUND_GAIN_SLICE_ID = '__fund_gain__'
const FUND_GAIN_COLOR    = '#a855f7'

function buildIncomeCategoryData(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
  unrealizedFundGain: number,
): CategorySlice[] {
  const base = buildCategoryData(transactions, categories, 'income')

  const realized  = sumBy(transactions.filter(tx => tx.type === 'income' && isRealizedInvestmentPnlTx(tx)), baseAmount)
  const fundTotal = toMajor(toMinor(realized) + toMinor(unrealizedFundGain))
  if (fundTotal <= 0) return base

  // Yüzdeler tüm dilimler üzerinden YENİDEN hesaplanır — buildCategoryData'nın
  // döndürdüğü percent yalnız kategorili gelir toplamına göreceliydi.
  const slices = [...base, {
    categoryId: FUND_GAIN_SLICE_ID,
    name:       'Fon Getirisi',
    amount:     fundTotal,
    percent:    0,
    color:      FUND_GAIN_COLOR,
  }]
  const total = sumBy(slices, s => s.amount)
  return slices
    .map(s => ({ ...s, percent: total > 0 ? (s.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

/* ── Tag distribution (expenses) ──────────────────────────────────────
   Attributes each tagged expense's full amount to EVERY tag it carries
   (multi-tag transactions are counted once per tag). Untagged and
   investment-linked expenses are excluded. Colors use the same
   deterministic tagColor logic as the TagBadges so tags read consistently
   across the app. `percent` is relative to the summed tag volume.
 ─────────────────────────────────────────────────────────────────────── */

function buildTagExpenseData(transactions: Transaction[]): CategorySlice[] {
  // amountMinor: TRY-normalized (baseAmount, S2/S3) integer kuruş (S8) — bir gider
  // taşıdığı her etikete tam tutarıyla yazılır; ham `amount` karışık PB toplamaz.
  const map = new Map<string, { amountMinor: number; casings: Map<string, number> }>()

  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.icon) continue
    if (isReconciliation(tx)) continue  // ghost reconciliation carries RECONCILE_TAG — exclude
    if (!tx.tags?.length) continue
    const amtMinor = toMinor(baseAmount(tx))
    const seen = new Set<string>()
    for (const raw of tx.tags) {
      const norm = normalizeTag(raw)
      if (!norm) continue
      const key = tagKey(norm)
      if (seen.has(key)) continue
      seen.add(key)
      let entry = map.get(key)
      if (!entry) { entry = { amountMinor: 0, casings: new Map() }; map.set(key, entry) }
      entry.amountMinor += amtMinor
      entry.casings.set(norm, (entry.casings.get(norm) ?? 0) + 1)
    }
  }

  // Same guard as buildCategoryData: a tag whose net expense is ≤ 0 (its only
  // spend was refunded, or it carries just a refund) must not reach the donut
  // as a negative slice.
  const entries = [...map.entries()].filter(([, e]) => e.amountMinor > 0)
  const totalMinor = entries.reduce((s, [, e]) => s + e.amountMinor, 0)
  if (totalMinor === 0) return []

  return entries
    .map(([key, entry]) => {
      // Canonical display casing = most frequent (ties → first-seen).
      let best = '', bestN = -1
      for (const [casing, n] of entry.casings) if (n > bestN) { bestN = n; best = casing }
      return {
        categoryId: key,  // tag key reused as the slice id
        name:       best,
        amount:     toMajor(entry.amountMinor),
        percent:    (entry.amountMinor / totalMinor) * 100,
        color:      tagColor(key),
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

function buildTrendData(
  accounts: Account[],
  allTransactions: Transaction[],
  dateRange: { from: string; to: string },
  selectedAccountId: string,
  prices: PriceData | null,
  investTxs: InvestmentTransaction[],
  fundPrices: Record<string, TefasFundPrice>,
): TrendPoint[] {
  const from = parseISO(dateRange.from)
  const to   = parseISO(dateRange.to)
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // Anlık görüntü tarihleri (artan). Kısa dönemlerde (≤ ~3 ay) günlük, uzunlarda
  // ay sonu — "Bu Ay" gibi tek aya sığan dönemler aylık kovalamada tek noktaya
  // düşer ve AreaChart çizgi çizemez. Gelecek günler çizilmez — henüz işlenmemiş
  // işlemlerle geri yürüyüş yapılamayacağından düz çizgi üretirler.
  const snaps: { label: string; snap: string }[] = []
  if (differenceInDays(to, from) + 1 <= 92) {
    let d = from
    while (d <= to) {
      const ds = format(d, 'yyyy-MM-dd')
      if (ds > todayStr) break
      snaps.push({ label: format(d, 'd MMM', { locale: tr }), snap: ds })
      d = addDays(d, 1)
    }
  } else {
    let mStart = startOfMonth(from)
    while (mStart <= to) {
      if (format(mStart, 'yyyy-MM-dd') > todayStr) break
      const mEnd = endOfMonth(mStart)
      snaps.push({
        label: format(mStart, 'MMM yy', { locale: tr }),
        snap:  format(mEnd > to ? to : mEnd, 'yyyy-MM-dd'),
      })
      mStart = addMonths(mStart, 1)
    }
  }
  if (snaps.length === 0) return []

  // account.balance sadece işlenmiş (bugüne kadarki) işlemleri içerir; geri-alma
  // yürüyüşü de aynı kümede kalmalı — gelecek tarihli işlemler geri alınmaz.
  const postedTxs = excludeFuture(allTransactions)
  const pts: TrendPoint[] = new Array(snaps.length)

  if (selectedAccountId === 'all') {
    // Net varlık: dashboard'daki NetWorthChart ile aynı yöntem. Bugünkü TRY
    // değerinden (kur çevirili hesap bakiyeleri + yatırımlar) geriye, her ayın
    // penceresindeki TRY-normalize ham net akış (mutabakat DAHİL) düşülerek
    // yürünür. Hesap bakiyeleri kendi para birimlerinde ham toplanamaz; transfer
    // bacakları da TRY bazında zaten netleştiğinden tek tek geri alınmaz.
    const investValue = prices
      ? computeHoldings(investTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0)
      : 0
    let nw = calcNetWorth(accounts, prices) + investValue
    let upper: string | null = null  // bir sonraki (daha yeni) snapshot — pencere üst sınırı
    for (let i = snaps.length - 1; i >= 0; i--) {
      const { label, snap } = snaps[i]
      nw -= calcNetRaw(postedTxs.filter(t => t.date > snap && (upper === null || t.date <= upper)))
      if (prices) {
        nw -= investTxs
          .filter(t => { const d = t.date.slice(0, 10); return d > snap && (upper === null || d <= upper) })
          .reduce((s, t) => s + (t.type === 'buy' ? 1 : -1) * t.quantity * getAssetPrice(t.asset, prices, fundPrices), 0)
      }
      pts[i] = { label, balance: nw }
      upper = snap
    }
    return pts
  }

  const account = accounts.find(a => a.id === selectedAccountId)
  if (!account) return []

  // Tek hesap: bakiye hesabın KENDİ para biriminde geri yürütülür. Çapraz kur
  // transferinin gelen bacağı bakiyeye çevrilmiş tutarla işlendiğinden
  // (computeTransactionEffect), geri alma da aynı çevrilmiş tutarı kullanmalı.
  let bal = account.balance
  let upper: string | null = null
  for (let i = snaps.length - 1; i >= 0; i--) {
    const { label, snap } = snaps[i]
    for (const tx of postedTxs) {
      if (tx.date <= snap || (upper !== null && tx.date > upper)) continue
      if (tx.type === 'income'   && tx.accountId === account.id)   bal -= tx.amount
      if (tx.type === 'expense'  && tx.accountId === account.id)   bal += tx.amount
      if (tx.type === 'transfer' && tx.accountId === account.id)   bal += tx.amount
      if (tx.type === 'transfer' && tx.toAccountId === account.id) {
        bal -= tx.currency === account.currency ? tx.amount : fromBaseTry(baseAmount(tx), account.currency)
      }
    }
    pts[i] = { label, balance: bal }
    upper = snap
  }
  return pts
}

/* ── Period comparison ────────────────────────────────────────────── */

type ComparisonRow = {
  categoryId: string | null
  name: string
  color: string
  current: number
  prev: number
  pct: number
}

function buildPeriodComparison(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
  dateRange: { from: string; to: string },
  accountId: string,
): ComparisonRow[] {
  const from = parseISO(dateRange.from)
  const to   = parseISO(dateRange.to)
  const days = differenceInDays(to, from) + 1
  const prevTo   = format(subDays(from, 1),    'yyyy-MM-dd')
  const prevFrom = format(subDays(from, days), 'yyyy-MM-dd')

  const catMap = new Map<string, { current: number; prev: number }>()

  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.icon) continue
    if (isReconciliation(tx)) continue  // ghost reconciliation — never a comparison expense
    if (accountId !== 'all' && tx.accountId !== accountId) continue
    const key = tx.categoryId ?? '__none__'
    if (!catMap.has(key)) catMap.set(key, { current: 0, prev: 0 })
    const entry = catMap.get(key)!
    const amt = baseAmount(tx)
    if (tx.date >= dateRange.from && tx.date <= dateRange.to) {
      entry.current += amt
    } else if (tx.date >= prevFrom && tx.date <= prevTo) {
      entry.prev += amt
    }
  }

  return [...catMap.entries()]
    .map(([key, { current, prev }]) => {
      const cat = categories.find(c => c.id === key)
      const pct = prev > 0 ? ((current - prev) / prev) * 100 : current > 0 ? 100 : 0
      return {
        categoryId: key === '__none__' ? null : key,
        name:       cat?.name  ?? 'Kategorisiz',
        color:      cat?.color ?? '#8C8C8C',
        current,
        prev,
        pct,
      }
    })
    .filter(r => r.current > 0 || r.prev > 0)
    .sort((a, b) => b.current - a.current)
    .slice(0, 6)
}

/* ── Category 6-month trend ───────────────────────────────────────── */

function buildCategoryTrendData(
  transactions: Transaction[],
  categoryId: string | null,
): CategoryTrendPoint[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const mDate = subMonths(now, 5 - i)
    const mFrom = format(startOfMonth(mDate), 'yyyy-MM-dd')
    const mTo   = format(endOfMonth(mDate),   'yyyy-MM-dd')
    const amount = transactions
      .filter(tx => {
        if (tx.type !== 'expense' || tx.icon) return false
        if (isReconciliation(tx)) return false  // ghost reconciliation — exclude from trend
        const d = tx.date.slice(0, 10)          // gün-sınırı toleransı (bkz. buildCashFlowData)
        if (d < mFrom || d > mTo) return false
        return categoryId === null ? !tx.categoryId : tx.categoryId === categoryId
      })
      .reduce((s, tx) => s + baseAmount(tx), 0)
    return { label: format(mDate, 'MMM yy', { locale: tr }), amount }
  })
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function ReportsPage() {
  const transactions  = useTransactionStore(s => s.transactions)
  const txsReady      = useTransactionStore(s => s.ready)
  const accountsReady = useAccountStore(s => s.ready)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const categories    = useCategoryStore(s => s.categories)
  const prices        = useInvestmentStore(s => s.prices)
  const fundPrices    = useInvestmentStore(s => s.fundPrices)
  const investTxs     = useInvestmentStore(s => s.transactions)
  const fetchPrices   = useInvestmentStore(s => s.fetchPrices)

  const [preset,       setPreset]       = useState<Preset>('this-month')
  const [customFrom,   setCustomFrom]   = useState('')
  const [customTo,     setCustomTo]     = useState('')
  const [accountId,    setAccountId]    = useState('all')
  // Fon getirisi anahtarı, Dashboard'daki "Fon getirileri dahil" ile AYNI kalıcı
  // ayardır (settings.includeFundGain) → iki sayfa aynı dönem için aynı Net'i
  // gösterir; oturumlar arası korunur. Ayrı bir yerel state kullanılmıyor.
  const includeInvestmentIncome = useSettingsStore(s => s.includeFundGain)
  const setIncludeInvestmentIncome = useSettingsStore(s => s.setIncludeFundGain)
  const [selectedCat,   setSelectedCat]   = useState<CategorySlice | null>(null)
  const [activeSliceIdx, setActiveSliceIdx] = useState<number | null>(null)
  // Gelir donut'u kendi drill-down seçimini tutar — gider seçimiyle çakışmasın,
  // ikisi aynı anda açık kalabilsin.
  const [selectedIncomeCat,   setSelectedIncomeCat]   = useState<CategorySlice | null>(null)
  const [activeIncomeSliceIdx, setActiveIncomeSliceIdx] = useState<number | null>(null)
  const [tagSliceIdx,   setTagSliceIdx]   = useState<number | null>(null)
  const [trendCatKey,   setTrendCatKey]   = useState<string>('')  // '' = auto (first in comparison list)

  // Nakit akışı detay overlay'i — dönem geneli ("Detay" butonu) veya tek bir
  // bar kovası (grafiğe tıklama) için aynı panel. `detail` içerik (kapanış
  // animasyonu boyunca korunur), `detailOpen` görünürlük.
  const [detail, setDetail] = useState<{ from: string; to: string; label: string } | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [cashFlowChartType, setCashFlowChartType] = useState<'bar' | 'line'>('bar')
  const openDetail = useCallback((d: { from: string; to: string; label: string }) => {
    setDetail(d)
    setDetailOpen(true)
  }, [])

  // Filtre (dönem/hesap) değişince tüm drill-down seçimlerini sıfırla. Filtreyi
  // değiştiren AYNI event handler içinde çağrılır — böylece bayat bir ara render
  // (eski seçim + yeni filtre) hiç oluşmaz.
  const resetDrilldown = useCallback(() => {
    setSelectedCat(null)
    setActiveSliceIdx(null)
    setSelectedIncomeCat(null)
    setActiveIncomeSliceIdx(null)
    setTagSliceIdx(null)
    setTrendCatKey('')
    setDetailOpen(false)
  }, [])

  const dateRange = useMemo(
    () => {
      // "Tüm Zamanlar" → başlangıç en erken işlem tarihi, bitiş BUGÜN. Bitişi son
      // işlem tarihine (max) sabitlemek yanlıştı: aralık kullanıcının son kaydından
      // öteye geçmiyor, dolayısıyla bugüne kadarki fon değeri/dönem güncel fiyatla
      // ölçülmüyordu. Başlangıç için 1970 gibi sabit erken tarih ise cash-flow
      // grafiğinde onlarca boş ay üretirdi → en erken işlemden başlarız. İşlem
      // yoksa (veya hepsi gelecek tarihliyse) getPresetRange varsayılanına düşer.
      if (preset === 'all-time') {
        let min = ''
        for (const t of transactions) {
          const d = t.date.slice(0, 10)
          if (!d) continue
          if (!min || d < min) min = d
        }
        const to = format(new Date(), 'yyyy-MM-dd') // bugüne kadar
        if (min && min <= to) return { from: min, to }
      }
      return getPresetRange(preset, customFrom, customTo)
    },
    [preset, customFrom, customTo, transactions],
  )

  /* ── Fon getirisi (gerçekleşmemiş) ──────────────────────────────────
     Dashboard'daki gelir kartıyla aynı hesap: seçili dönemin TEFAS fon
     değer kazancı. calcFundPeriodGain dönem sonunu tarihe göre alır — güncel
     dönemlerde canlı fiyat, geçmişte biten (özel) aralıklarda `to` gününe kadarki
     son kapanış — böylece her tarih aralığında doğru akar. Yalnız portföy geneli
     (Tüm Hesaplar) için anlamlıdır; tek hesap seçiliyken 0 tutulur (fon getirisi
     portföy geneli bir büyüklük). Dönem başı/sonu kapanışı için fon başına günlük
     seri bir kez çekilir (kod+dönem anahtarı; tarihi veri değişmez). */
  const fundEligible = accountId === 'all'
  const fundCodes    = useMemo(() => tefasCodesIn(investTxs.map(t => t.asset)), [investTxs])
  const [fundHistory, setFundHistory] = useState<Record<string, FundPricePoint[]>>({})
  const histRequested = useRef(new Set<string>())

  // Fon/FX fiyatlarını doldur (doğrudan /reports açılışında store boş olabilir).
  useEffect(() => { fetchPrices() }, [fetchPrices])

  // Dönem başı kapanış serisi ('Bugün' son iki kapanış farkını kullandığından
  // seri gerektirmez; uygun olmayan dönemlerde hiç istenmez).
  useEffect(() => {
    if (!fundEligible || preset === 'today' || fundCodes.length === 0) return
    const histFrom = format(subDays(parseISO(dateRange.from), 10), 'yyyy-MM-dd')
    for (const code of fundCodes) {
      const key = `${code}:${dateRange.from}`
      if (histRequested.current.has(key)) continue
      histRequested.current.add(key)
      fetch(`/api/prices/history?asset=TEFAS&code=${code}&from=${histFrom}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((pts: FundPricePoint[] | null) => {
          if (Array.isArray(pts) && pts.length) setFundHistory(h => ({ ...h, [key]: pts }))
          else histRequested.current.delete(key)
        })
        .catch(() => histRequested.current.delete(key))
    }
  }, [fundEligible, preset, fundCodes, dateRange.from])

  const fundPeriodNet = useMemo(() => {
    if (!fundEligible) return 0
    const hist: Record<string, FundPricePoint[]> = {}
    for (const code of fundCodes) {
      const pts = fundHistory[`${code}:${dateRange.from}`]
      if (pts) hist[code] = pts
    }
    return calcFundPeriodGain(investTxs, fundPrices, hist, dateRange.from, dateRange.to, preset === 'today')
  }, [fundEligible, fundCodes, fundHistory, investTxs, fundPrices, dateRange, preset])

  // Anahtar AÇIKKEN gerçekleşmemiş dönem fon getirisi (pozitif-kapı) Toplam Gelir/
  // Net Tasarruf KPI'larına ve gelir donut'una ("Fon Getirisi" dilimi) eklenir —
  // dashboard ile BİREBİR aynı formül, iki sayfa aynı aylık geliri göstersin.
  // Negatif dönem getirisi eklenmez (fundGain=0); alt-etikette bilgi olarak görünür.
  // Ledger'daki gerçekleşen "Satış Kârı" satırları ayrı yol izler: anahtar açıkken
  // filteredTxs'te kalıp flow.income'a girerler (bkz. buildIncomeCategoryData).
  const fundGain = includeInvestmentIncome && fundPeriodNet > 0 ? fundPeriodNet : 0

  // Taksitli alışverişler raporda BÖLÜNMEZ: tüm taksitler satın alma ayına tek
  // bir toplam gider olarak yazılır (bkz. collapseInstallments). İndirgeme
  // excludeFuture'dan ÖNCE, tüm defter üzerinde yapılmalı — aksi halde henüz
  // gelmemiş taksitler elenir ve toplam eksik çıkar.
  const reportTxs = useMemo(() => collapseInstallments(transactions), [transactions])

  // Analitik akış yüzeylerinin ortak temeli: yalnız İŞLENMİŞ satırlar (isPosted —
  // pending/gelecek tarihli satırlar hiçbir gelir/gider toplamına girmez; bakiye
  // ile aynı kural). Bakiye/net varlık trendleri ham `transactions` okumaya devam
  // eder (kendi excludeFuture'ları var, ghost'ları da bilerek tutarlar; taksitler
  // orada gerçek nakit akışı olarak aya yayılı kalmalı).
  const postedTxs = useMemo(() => excludeFuture(reportTxs), [reportTxs])

  // Base analytic scope: period + account filtered, with ghost balance-
  // reconciliation entries stripped out. Every income/expense aggregate below
  // (KPIs, cash-flow, category & tag donuts, drill-downs) derives from this, so
  // reconciliation never inflates them.
  const filteredTxs = useMemo(() =>
    postedTxs.filter(tx => {
      const d = tx.date.slice(0, 10)
      if (d < dateRange.from || d > dateRange.to) return false
      if (isReconciliation(tx)) return false
      // Satış anaparası ("… Satışı") her durumda akış toplamlarından hariç
      // (isInvestmentPrincipalTx, calcPeriodFlow içinde) — özsermaye geri dönüşü
      // gelir değildir. GERÇEKLEŞEN satış kârı/zararı ("… Satış Kârı/Zararı") ise
      // "Fon getirisi" anahtarı (includeFundGain) KAPALIYKEN gelir/giderden çıkarılır
      // — dashboard ile birebir aynı (isRealizedInvestmentPnlTx); açıkken dahildir.
      if (!includeInvestmentIncome && isRealizedInvestmentPnlTx(tx)) return false
      if (accountId !== 'all') {
        if (tx.accountId !== accountId && tx.toAccountId !== accountId) return false
      }
      return true
    }),
    [postedTxs, dateRange, accountId, includeInvestmentIncome],
  )

  const kpi = useMemo(() => {
    // filteredTxs zaten dönem+hesap filtreli ve mutabakat ayıklanmış; calcPeriodFlow
    // TRY-normalize (baseAmount) + kuruş-exact toplar → dashboard'daki gelir/gider
    // kartlarıyla (calcPeriodFlow/calcMonthlyFlow) birebir aynı sayı.
    //
    // "Toplam Gelir" gerçekleşen nakit geliri gösterir; gerçekleşmemiş fon getirisi
    // (fundGain, mark-to-market) buraya EKLENMEZ — çünkü o dönem-göreceli bir kağıt
    // kazançtır ve "Tüm Zamanlar"da güncel toplam K/Z olduğundan tek bir ayınkinin
    // altında kalabiliyordu (gelir dönem büyüdükçe monoton artmalı). Realize satış
    // kârı/zararı ise anahtar AÇIKKEN dahildir, KAPALIYKEN filteredTxs'te çıkarıldı
    // (dashboard ile aynı aylık gelir). Fon getirisi alt-etikette ayrı gösterilir.
    const flow    = calcPeriodFlow(filteredTxs, dateRange.from, dateRange.to)
    const income  = flow.income
    const expense = flow.expense
    const net     = income - expense
    const rate    = income > 0 ? (net / income) * 100 : 0
    return { income, expense, net, rate }
  }, [filteredTxs, dateRange])

  // Nakit akışı = yalnızca gerçek nakit gelir/gider. Gerçekleşmemiş fon getirisi
  // barlara EKLENMEZ (para hareketi yok) — KPI "Toplam Gelir" değeri de artık
  // yalnız gerçekleşen nakit olduğundan ikisi tam tutarlı.
  const cashFlowData    = useMemo(() => buildCashFlowData(filteredTxs, dateRange), [filteredTxs, dateRange])
  const categoryData    = useMemo(() => buildCategoryData(filteredTxs, categories),                   [filteredTxs, categories])
  const incomeCatData   = useMemo(() => buildIncomeCategoryData(filteredTxs, categories, fundGain),    [filteredTxs, categories, fundGain])
  const tagData         = useMemo(() => buildTagExpenseData(filteredTxs),                             [filteredTxs])
  const topTags         = useMemo(() => tagData.slice(0, 8),                                          [tagData])
  const trendData       = useMemo(
    () => buildTrendData(accounts, transactions, dateRange, accountId, prices, investTxs, fundPrices),
    [accounts, transactions, dateRange, accountId, prices, investTxs, fundPrices],
  )
  const comparisonData  = useMemo(() => buildPeriodComparison(postedTxs, categories, dateRange, accountId), [postedTxs, categories, dateRange, accountId])

  const activeTrendCat  = useMemo(() => {
    if (!trendCatKey) return comparisonData[0] ?? null
    return comparisonData.find(r => (r.categoryId ?? '__none__') === trendCatKey) ?? comparisonData[0] ?? null
  }, [trendCatKey, comparisonData])

  const catTrendData    = useMemo(
    () => activeTrendCat ? buildCategoryTrendData(postedTxs, activeTrendCat.categoryId) : [],
    [postedTxs, activeTrendCat],
  )

  const prevPeriodLabel = useMemo(() => {
    const from  = parseISO(dateRange.from)
    const days  = differenceInDays(parseISO(dateRange.to), from) + 1
    const pFrom = subDays(from, days)
    const pTo   = subDays(from, 1)
    return `${format(pFrom, 'd MMM', { locale: tr })} – ${format(pTo, 'd MMM yy', { locale: tr })}`
  }, [dateRange])

  const catFilteredTxs = useMemo(() => {
    if (!selectedCat) return []
    return filteredTxs.filter(tx => {
      if (tx.type !== 'expense') return false
      return selectedCat.categoryId === null ? !tx.categoryId : tx.categoryId === selectedCat.categoryId
    })
  }, [filteredTxs, selectedCat])

  // Gelir drill-down'u: donut kapsamıyla birebir aynı satırlar — yatırım-ikonlu
  // gelirler (anapara/realize kâr) dilimlere girmediği için listeye de girmez,
  // aksi halde başlıktaki toplam listedekiyle tutmazdı.
  const incomeCatFilteredTxs = useMemo(() => {
    if (!selectedIncomeCat) return []
    return filteredTxs.filter(tx => {
      if (tx.type !== 'income' || tx.icon) return false
      return selectedIncomeCat.categoryId === null ? !tx.categoryId : tx.categoryId === selectedIncomeCat.categoryId
    })
  }, [filteredTxs, selectedIncomeCat])

  const isLoading = !txsReady || !accountsReady

  // Nakit akışı kartındaki açıklama notu yalnız dönemde taksitli bir satın alma
  // varken gösterilir (aksi halde gereksiz gürültü).
  const hasInstallment = useMemo(() => filteredTxs.some(t => t.isInstallment), [filteredTxs])

  const incomeTotal  = kpi.income + fundGain
  const netTotal     = kpi.net + fundGain
  const rateTotal    = incomeTotal > 0 ? (netTotal / incomeTotal) * 100 : 0
  // Sayaç animasyonu <AnimatedNumber> YAPRAK bileşeninde tutulur; useCountUp bu
  // sayfada DOĞRUDAN çağrılamaz. Hook her karede setState eder: sayfa gövdesinde
  // çağrıldığında 5 sayaç × ~60fps boyunca tüm ReportsPage'i (5 Recharts grafiği,
  // tablolar, TransactionList) yeniden render ediyordu. Grafiklerin kare-başına
  // commit'leri React'in sonsuz-döngü dedektörünü (nested update limiti 50)
  // tetikleyip sayfayı "Maximum update depth exceeded" ile error boundary'ye
  // düşürüyordu — mobilde her genişlikte tekrarlanabilir bir çökme.
  // Yaprak bileşen animasyonu yalnız ilgili <span>'e hapseder.
  // Nakit akışı kartı başlığındaki Net, barlarla (gerçek nakit gelir/gider) tutarlı:
  // gerçekleşmemiş fon getirisi (fundGain) burada YOK — barlar da onu içermez.
  const cashFlowNet     = kpi.net

  // Seçili aralıktaki net değişim (ilk → son nokta), trend başlığında gösterilir
  const trendFirst = trendData[0]?.balance ?? 0
  const trendLast  = trendData.at(-1)?.balance ?? 0
  const trendDelta = trendLast - trendFirst
  const trendPct   = trendFirst !== 0 ? (trendDelta / Math.abs(trendFirst)) * 100 : 0

  return (
    <>
      <Header title="Raporlar" />

      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-border/50 bg-card flex flex-wrap items-center gap-3 flex-shrink-0">

        <div className="flex gap-0.5 bg-background p-1 rounded-xl">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => { setPreset(p.key); resetDrilldown() }}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap',
                preset === p.key ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground rounded-xl',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => { setCustomFrom(e.target.value); resetDrilldown() }}
              className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => { setCustomTo(e.target.value); resetDrilldown() }}
              className="border border-border rounded-xl px-2 py-1.5 text-xs text-foreground bg-card focus:outline-none focus:border-primary"
            />
          </div>
        )}

        <label className="ml-auto flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={includeInvestmentIncome}
            onChange={e => setIncludeInvestmentIncome(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary cursor-pointer"
          />
          <span className="text-xs font-medium text-muted-foreground">Fon getirileri dahil</span>
        </label>

        <SelectField
          value={accountId}
          onChange={e => { setAccountId(e.target.value); resetDrilldown() }}
          options={[
            { value: 'all', label: 'Tüm Hesaplar' },
            ...accounts.map(a => ({ value: a.id, label: a.name })),
          ]}
          className="w-fit bg-card text-xs"
        />
      </div>

      <div className="p-6 flex flex-col gap-6 overflow-auto flex-1">

        {/* ── KPI Cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {isLoading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="px-5 py-4">
                  <div className="h-2.5 w-20 bg-muted rounded animate-pulse mb-3" />
                  <div className="h-7 w-32 bg-muted rounded animate-pulse" />
                  <div className="h-2 w-16 bg-muted rounded animate-pulse mt-2" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <KPICard
                label="Toplam Gelir"
                value={<AnimatedNumber value={incomeTotal} format={formatCurrency} />}
                sub={(() => {
                  const n = filteredTxs.filter(t => t.type === 'income').length
                  // Anahtar açık + pozitif getiri → gelire DAHİL (dashboard ile aynı).
                  // Negatif dönem getirisi eklenmez; yalnız bilgi olarak gösterilir.
                  if (includeInvestmentIncome && fundPeriodNet > 0.005)
                    return `${n} işlem · +${formatCompact(fundPeriodNet)} fon getirisi dahil`
                  if (includeInvestmentIncome && fundPeriodNet < -0.005)
                    return `${n} işlem · −${formatCompact(Math.abs(fundPeriodNet))} fon değişimi (eklenmedi)`
                  return `${n} işlem`
                })()}
                color="ok"
              />
              <KPICard
                label="Toplam Gider"
                value={<AnimatedNumber value={kpi.expense} format={formatCurrency} />}
                sub={`${filteredTxs.filter(t => t.type === 'expense').length} işlem`}
                color="danger"
              />
              <KPICard
                label="Net Tasarruf"
                value={<AnimatedNumber value={Math.abs(netTotal)} format={formatCurrency} />}
                sub={netTotal >= 0 ? 'Pozitif birikim' : 'Açık var'}
                prefix={netTotal >= 0 ? '+' : '−'}
                color={netTotal >= 0 ? 'ok' : 'danger'}
              />
              <KPICard
                label="Tasarruf Oranı"
                value={`${Math.abs(rateTotal).toFixed(1)}%`}
                sub={rateTotal >= 20 ? 'Hedefin üstünde' : rateTotal > 0 ? 'Geliştirilebilir' : 'Gelir eksik'}
                prefix={rateTotal < 0 ? '−' : ''}
                color={rateTotal >= 20 ? 'ok' : rateTotal >= 0 ? 'neutral' : 'danger'}
              />
            </>
          )}
        </div>

        {/* ── Charts row 1: Cash Flow (tam genişlik) ────────────────── */}
        <div className="grid grid-cols-1 gap-6">

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Nakit Akışı</span>
              <div className="flex items-center gap-3">
                {!isLoading && (
                  <span className={`text-xs font-medium tabular-nums ${cashFlowNet >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                    Net: {cashFlowNet >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(cashFlowNet)} format={formatCurrency} />
                  </span>
                )}
                {!isLoading && (
                  <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60">
                    <button
                      onClick={() => setCashFlowChartType('bar')}
                      className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${cashFlowChartType === 'bar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      title="Sütun grafik"
                      aria-pressed={cashFlowChartType === 'bar'}
                    >
                      <BarChart3 size={13} />
                    </button>
                    <button
                      onClick={() => setCashFlowChartType('line')}
                      className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${cashFlowChartType === 'line' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      title="Çizgi grafik"
                      aria-pressed={cashFlowChartType === 'line'}
                    >
                      <LineChartIcon size={13} />
                    </button>
                  </div>
                )}
                {!isLoading && (
                  <button
                    onClick={() => openDetail({
                      from:  dateRange.from,
                      to:    dateRange.to,
                      label: PRESETS.find(p => p.key === preset)?.label ?? 'Dönem',
                    })}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-accent transition-colors"
                    title="İşlemleri görüntüle"
                  >
                    <ListFilter size={13} />
                    Detay
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <BarSkeleton /> : (
                    <CashFlowBarChart
                      data={cashFlowData}
                      chartType={cashFlowChartType}
                      onBarClick={p => openDetail({ from: p.from, to: p.to, label: p.label })}
                    />
                  )}
                </div>
              </div>
              <div className="px-5 pb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <LegendDot color="var(--cf-income)" label="Gelir" />
                <LegendDot color="var(--cf-expense)" label="Gider" />
                {/* Taksitli alışverişler burada aya yayılmaz — toplam tutar satın
                    alma ayında görünür (bkz. collapseInstallments). */}
                {hasInstallment && (
                  <span className="text-[11px] text-muted-foreground/80">
                    Taksitli alışverişler satın alma ayına toplam yazılır
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

        </div>

        {/* ── Charts row 2: Kategori dağılımları (gider + gelir) ─────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Kategori Bazlı Giderler</span>
              {selectedCat && (
                <button
                  onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: selectedCat.color }} />
                  {selectedCat.name}
                  <span className="ml-1 opacity-50">✕</span>
                </button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <DonutSkeleton /> : (
                    <CategoryDonutChart
                      data={categoryData}
                      activeIndex={activeSliceIdx}
                      onSliceClick={(slice, idx) => {
                        if (activeSliceIdx === idx) {
                          setSelectedCat(null)
                          setActiveSliceIdx(null)
                        } else {
                          setSelectedCat(slice)
                          setActiveSliceIdx(idx)
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Kategori Bazlı Gelirler</span>
              {selectedIncomeCat && (
                <button
                  onClick={() => { setSelectedIncomeCat(null); setActiveIncomeSliceIdx(null) }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <span className="w-2 h-2 rounded-sm inline-block" style={{ background: selectedIncomeCat.color }} />
                  {selectedIncomeCat.name}
                  <span className="ml-1 opacity-50">✕</span>
                </button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <DonutSkeleton /> : (
                    <CategoryDonutChart
                      data={incomeCatData}
                      activeIndex={activeIncomeSliceIdx}
                      emptyMessage="Bu dönemde gelir kaydedilmemiş"
                      onSliceClick={(slice, idx) => {
                        if (activeIncomeSliceIdx === idx) {
                          setSelectedIncomeCat(null)
                          setActiveIncomeSliceIdx(null)
                          return
                        }
                        setActiveIncomeSliceIdx(idx)
                        // "Fon Getirisi" bir defter kategorisi değil: gerçekleşmemiş
                        // kısmının işlem satırı yok, dolayısıyla başlıktaki toplam
                        // listeyle tutmaz → yalnız vurgulanır, drill-down açılmaz.
                        setSelectedIncomeCat(slice.categoryId === FUND_GAIN_SLICE_ID ? null : slice)
                      }}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* ── Category drill-down ───────────────────────────────────── */}
        {selectedCat && !isLoading && (
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border/50">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedCat.color }} />
              <span className="text-sm font-semibold text-foreground/90 flex-1">
                {selectedCat.name} — {catFilteredTxs.length} işlem
              </span>
              <span className="text-sm font-medium tabular-nums text-destructive">
                −{formatCurrency(selectedCat.amount)}
              </span>
              <button
                onClick={() => { setSelectedCat(null); setActiveSliceIdx(null) }}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm flex-shrink-0"
                title="Kapat"
              >✕</button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto" style={{ maxHeight: 440 }}>
                <TransactionList
                  transactions={catFilteredTxs}
                  showAccount
                  emptyTitle="İşlem bulunamadı"
                  emptyDescription="Seçili dönemde bu kategoride gider yok."
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Income category drill-down ────────────────────────────── */}
        {selectedIncomeCat && !isLoading && (
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center gap-3 px-5 py-4 border-b border-border/50">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: selectedIncomeCat.color }} />
              <span className="text-sm font-semibold text-foreground/90 flex-1">
                {selectedIncomeCat.name} — {incomeCatFilteredTxs.length} işlem
              </span>
              <span className="text-sm font-medium tabular-nums text-green-600">
                +{formatCurrency(selectedIncomeCat.amount)}
              </span>
              <button
                onClick={() => { setSelectedIncomeCat(null); setActiveIncomeSliceIdx(null) }}
                className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors text-sm flex-shrink-0"
                title="Kapat"
              >✕</button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto" style={{ maxHeight: 440 }}>
                <TransactionList
                  transactions={incomeCatFilteredTxs}
                  showAccount
                  emptyTitle="İşlem bulunamadı"
                  emptyDescription="Seçili dönemde bu kategoride gelir yok."
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Tag Analytics: distribution + top tags ─────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Etiket Dağılımı */}
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">Etiket Dağılımı</span>
              {!isLoading && tagData.length > 0 && (
                <span className="text-xs text-muted-foreground">{tagData.length} etiket</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  {isLoading ? <DonutSkeleton /> : tagData.length === 0 ? (
                    <TagEmptyState />
                  ) : (
                    <CategoryDonutChart
                      data={tagData}
                      activeIndex={tagSliceIdx}
                      onSliceClick={(_slice, idx) => setTagSliceIdx(prev => prev === idx ? null : idx)}
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* En Aktif Etiketler */}
          <Card className="overflow-hidden gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90">En Aktif Etiketler</span>
              {!isLoading && topTags.length > 0 && (
                <span className="text-xs text-muted-foreground">Gider hacmi</span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <AdvancedSkeleton />
              ) : topTags.length === 0 ? (
                <TagEmptyState />
              ) : (
                <div className="p-5 flex flex-col gap-0.5">
                  {topTags.map((t, i) => {
                    const width = topTags[0].amount > 0 ? (t.amount / topTags[0].amount) * 100 : 0
                    return (
                      <Link
                        key={t.categoryId}
                        href={`/tags/${encodeURIComponent(t.name)}`}
                        className="group flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors"
                      >
                        <span className="text-[11px] tabular-nums text-muted-foreground w-4 text-right flex-shrink-0">{i + 1}</span>
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: t.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] text-foreground/80 truncate group-hover:text-primary transition-colors">
                              #{t.name}
                            </span>
                            <span className="text-[13px] tabular-nums font-medium text-foreground/70 flex-shrink-0">
                              {formatCompact(t.amount)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: t.color }} />
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* ── Balance / Net Worth Trend ──────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">
              {accountId === 'all' ? 'Net Varlık Trendi' : 'Hesap Bakiye Trendi'}
            </span>
            {!isLoading && trendData.length > 0 && (
              <span className="flex items-center gap-3 text-xs font-medium tabular-nums">
                {trendData.length >= 2 && trendDelta !== 0 && (
                  <span className={trendDelta >= 0 ? 'text-green-600' : 'text-destructive'}>
                    {trendDelta >= 0 ? '+' : ''}{formatCompact(trendDelta)}
                    {' '}({trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%)
                  </span>
                )}
                <span className={trendLast >= 0 ? 'text-green-600' : 'text-destructive'}>
                  Güncel: <AnimatedNumber value={trendLast} format={formatCurrency} />
                </span>
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                {isLoading ? <BarSkeleton /> : <BalanceTrendChart data={trendData} />}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Advanced Analytics ────────────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">Gelişmiş Analiz</span>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                Önceki dönem: {prevPeriodLabel}
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">
                <AdvancedSkeleton />
                <AdvancedSkeleton />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border/50">

                {/* Period comparison table */}
                <div className="p-5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Dönem Karşılaştırması
                  </div>
                  {comparisonData.length === 0 ? (
                    <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
                      Gider verisi bulunamadı
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {comparisonData.map((row, idx) => {
                        const key = row.categoryId ?? '__none__'
                        const isActive = trendCatKey ? trendCatKey === key : idx === 0
                        return (
                          <button
                            key={key}
                            onClick={() => setTrendCatKey(isActive && !!trendCatKey ? '' : key)}
                            className={[
                              'flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors w-full',
                              isActive ? 'bg-muted' : 'hover:bg-accent',
                            ].join(' ')}
                          >
                            <span
                              className="w-2 h-2 rounded-sm flex-shrink-0"
                              style={{ background: row.color }}
                            />
                            <span className="text-[13px] text-foreground/80 flex-1 truncate min-w-0">
                              {row.name}
                            </span>
                            <span className="text-[13px] tabular-nums text-foreground/70 font-medium">
                              {formatCompact(row.current)}
                            </span>
                            <PctBadge pct={row.pct} />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 6-month category trend */}
                <div className="p-5">
                  {activeTrendCat ? (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ background: activeTrendCat.color }}
                        />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Son 6 Ay — {activeTrendCat.name}
                        </span>
                      </div>
                      <CategoryTrendChart data={catTrendData} color={activeTrendCat.color} />
                    </>
                  ) : (
                    <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">
                      Kategori seçin
                    </div>
                  )}
                </div>

              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {detail && (
        <CashFlowDetailOverlay
          open={detailOpen}
          from={detail.from}
          to={detail.to}
          label={detail.label}
          transactions={filteredTxs}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  )
}

/* ── Sub-components ───────────────────────────────────────────────── */

function KPICard({
  label, value, sub, prefix = '', color = 'neutral',
}: {
  label: string
  value: ReactNode
  sub?: string
  prefix?: string
  color?: 'ok' | 'danger' | 'neutral'
}) {
  const cls = color === 'ok' ? 'text-green-600' : color === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="@container px-4 sm:px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`kpi-value font-normal tabular-nums ${cls}`}>
          {prefix}{value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function TagEmptyState() {
  return (
    <div className="h-[280px] flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground/60 text-xl font-bold select-none">
        #
      </div>
      <p className="text-sm text-muted-foreground">Bu dönemde etiketli işlem bulunmuyor</p>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 inline-block" style={{ background: color }} />
      <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
    </div>
  )
}

function BarSkeleton() {
  return (
    <div className="flex items-end gap-2 px-4 pb-2 pt-4" style={{ height: 252 }}>
      {[65, 40, 80, 55, 70, 45, 75, 50].map((h, i) => (
        <div key={i} className="flex-1 flex gap-0.5 items-end">
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h}%` }} />
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h * 0.65}%` }} />
        </div>
      ))}
    </div>
  )
}

function DonutSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-6" style={{ minHeight: 340 }}>
      <div className="w-44 h-44 rounded-full border-[20px] border-border animate-pulse" />
      <div className="grid grid-cols-2 gap-2 px-6 w-full">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 bg-muted rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

function AdvancedSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-2">
      <div className="h-2.5 w-28 bg-muted rounded animate-pulse mb-2" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-9 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  )
}

function PctBadge({ pct }: { pct: number }) {
  if (!isFinite(pct) || Math.abs(pct) < 0.5) {
    return <span className="text-[11px] text-muted-foreground tabular-nums w-12 text-right">—</span>
  }
  const up = pct > 0
  return (
    <span className={['text-[11px] font-semibold tabular-nums w-12 text-right', up ? 'text-destructive' : 'text-green-600'].join(' ')}>
      {up ? '+' : ''}{pct.toFixed(0)}%
    </span>
  )
}
