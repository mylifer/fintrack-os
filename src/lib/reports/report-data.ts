import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { tr } from 'date-fns/locale'
import { normalizeTag, tagKey, tagColor } from '@/lib/utils/tags'
import { isReconciliation } from '@/lib/utils/reconciliation'
import { sumExpenseByKey, sumIncomeByKey, isRealizedInvestmentPnlTx } from '@/lib/utils/calculations'
import { expandByCategory } from '@/lib/utils/categorySplits'
import { baseAmount } from '@/lib/utils/fx'
import { toMinor, toMajor, sumBy } from '@/lib/utils/money'
import type { CategorySlice }       from '@/components/reports/_CategoryDonutChart'
import type { CategoryTrendPoint }  from '@/components/reports/_CategoryTrendChart'
import type { Transaction } from '@/types'

// Raporlar sayfasının saf toplayıcıları (reports/page.tsx'ten taşındı): kategori
// ve etiket dağılımları, dönem karşılaştırması, kategori 6-ay trendi.

export function buildCategoryData(
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

export const FUND_GAIN_SLICE_ID = '__fund_gain__'
export const FUND_GAIN_COLOR    = '#a855f7'

export function buildIncomeCategoryData(
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

export function buildTagExpenseData(transactions: Transaction[]): CategorySlice[] {
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

/* ── Period comparison ────────────────────────────────────────────── */

export type ComparisonRow = {
  categoryId: string | null
  name: string
  color: string
  current: number
  prev: number
  pct: number
}

export function buildPeriodComparison(
  transactions: Transaction[],
  categories: Array<{ id: string; name: string; color: string }>,
  dateRange: { from: string; to: string },
  accountId: string,
  prevRange: { from: string; to: string },
): ComparisonRow[] {
  const { from: prevFrom, to: prevTo } = prevRange

  const catMap = new Map<string, { current: number; prev: number }>()

  // Çoklu kategori: karşılaştırma da kategori paylarını sayar (bkz. expandByCategory).
  for (const tx of expandByCategory(transactions)) {
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

export function buildCategoryTrendData(
  transactions: Transaction[],
  categoryId: string | null,
): CategoryTrendPoint[] {
  const now = new Date()
  // Çoklu kategori: bölünmüş satırlar paylarına açılır → trend, kategoriye
  // düşen payı gösterir (işlemin tamamını değil).
  const sliced = expandByCategory(transactions)
  return Array.from({ length: 6 }, (_, i) => {
    const mDate = subMonths(now, 5 - i)
    const mFrom = format(startOfMonth(mDate), 'yyyy-MM-dd')
    const mTo   = format(endOfMonth(mDate),   'yyyy-MM-dd')
    const amount = sliced
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
