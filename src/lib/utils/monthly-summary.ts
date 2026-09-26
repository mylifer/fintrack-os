import { endOfMonth, format, getDaysInMonth, parseISO } from 'date-fns'
import { calcPeriodFlow, excludeFuture, isRealizedInvestmentPnlTx, sumExpenseByKey } from './calculations'
import { collapseInstallments } from './installments'
import { isReconciliation } from './reconciliation'
import { baseAmount } from './fx'
import { pctChange } from './period-compare'
import type { Category, MonthYear, Transaction } from '@/types'

/* Aylık Özet (Raporlar → Aylık Özet): bir ayın gelir/gider/net/tasarruf oranı,
   önceki ay ve geçen yılın aynı ayıyla kıyas, en çok harcanan kategoriler ve en
   büyük tekil giderler.

   Rakamlar Raporlar sayfasıyla BİREBİR aynı kuralla hesaplanır: taksitler satın
   alma ayına toplu (collapseInstallments), yalnız işlenmiş satırlar
   (excludeFuture), mutabakat hariç, "Fon getirisi" anahtarı kapalıyken realize
   yatırım K/Z hariç; akış toplamı calcPeriodFlow, kategori dağılımı
   sumExpenseByKey.

   DEVAM EDEN AY: ay bitmediyse (asOf ay içindeyse) kıyas dönemleri de aynı gün
   sayısına kırpılır — 1–26 Eylül, 1–26 Ağustos ve 1–26 Eylül geçen yıl ile
   kıyaslanır. Yarım ayı tam bir ayla kıyaslamak her ayı "harcama düştü" diye
   gösterirdi. */

export interface MonthFlow {
  from: string
  to: string
  income: number
  expense: number
  net: number
  /** net / gelir × 100; gelir yoksa null */
  savingsRate: number | null
}

export interface CategoryRow {
  categoryId: string | null
  name: string
  color: string
  amount: number
  prevAmount: number
  yearAmount: number
  /** önceki aya göre % değişim; önceki ay 0 ise null ("yeni") */
  change: number | null
}

export interface MonthlySummary {
  current: MonthFlow
  previous: MonthFlow
  lastYear: MonthFlow
  /** ay devam ediyorsa true — kıyaslar aynı gün sayısına kırpılmıştır */
  partial: boolean
  /** ayın kaçıncı gününe kadar sayıldı (tam ayda ayın gün sayısı) */
  daysCounted: number
  daysInMonth: number
  dailyAvgExpense: number
  txCount: number
  categories: CategoryRow[]
  /** önceki aya göre en çok artan 3 kategori (tutar farkına göre) */
  increases: CategoryRow[]
  largestExpenses: Transaction[]
}

function shiftMonth(my: MonthYear, delta: number): MonthYear {
  const idx = my.year * 12 + (my.month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

/** Ayın ilk `days` günü (ay kısaysa ay sonuna kırpılır). */
function monthSlice(my: MonthYear, days: number): { from: string; to: string } {
  const first = new Date(my.year, my.month - 1, 1)
  const last  = Math.min(days, getDaysInMonth(first))
  return {
    from: format(first, 'yyyy-MM-dd'),
    to:   format(new Date(my.year, my.month - 1, last), 'yyyy-MM-dd'),
  }
}

function flowOf(txs: Transaction[], range: { from: string; to: string }): MonthFlow {
  const f = calcPeriodFlow(txs, range.from, range.to)
  return {
    ...range,
    income: f.income,
    expense: f.expense,
    net: f.net,
    savingsRate: f.income > 0 ? (f.net / f.income) * 100 : null,
  }
}

function inRange(t: Transaction, r: { from: string; to: string }): boolean {
  const d = t.date.slice(0, 10)
  return d >= r.from && d <= r.to
}

export function buildMonthlySummary(
  transactions: Transaction[],
  my: MonthYear,
  categories: Pick<Category, 'id' | 'name' | 'color'>[],
  opts: { includeRealizedPnl: boolean; asOf: string },
): MonthlySummary {
  const { asOf } = opts
  const ledger = excludeFuture(collapseInstallments(transactions), asOf)
    .filter(t => !isReconciliation(t) && (opts.includeRealizedPnl || !isRealizedInvestmentPnlTx(t)))

  const monthStart  = new Date(my.year, my.month - 1, 1)
  const daysInMonth = getDaysInMonth(monthStart)
  const monthEnd    = format(endOfMonth(monthStart), 'yyyy-MM-dd')
  const partial     = asOf >= format(monthStart, 'yyyy-MM-dd') && asOf < monthEnd
  const daysCounted = partial ? parseISO(asOf).getDate() : daysInMonth

  const curRange  = monthSlice(my, daysCounted)
  // Tam ayda kıyas ayı da TAM alınır (31 Ağustos'a karşı 30 Eylül değil, tüm
  // Ağustos); kırpma yalnız devam eden ayda.
  const prevMy    = shiftMonth(my, -1)
  const yearMy    = shiftMonth(my, -12)
  const prevRange = monthSlice(prevMy, partial ? daysCounted : 31)
  const yearRange = monthSlice(yearMy, partial ? daysCounted : 31)

  const current  = flowOf(ledger, curRange)
  const previous = flowOf(ledger, prevRange)
  const lastYear = flowOf(ledger, yearRange)

  const curTxs  = ledger.filter(t => inRange(t, curRange))
  const byCur   = sumExpenseByKey(curTxs, t => t.categoryId ?? '__none__')
  const byPrev  = sumExpenseByKey(ledger.filter(t => inRange(t, prevRange)), t => t.categoryId ?? '__none__')
  const byYear  = sumExpenseByKey(ledger.filter(t => inRange(t, yearRange)), t => t.categoryId ?? '__none__')

  const catById = new Map(categories.map(c => [c.id, c]))
  const rowFor = (key: string): CategoryRow => {
    const cat = catById.get(key)
    const amount = byCur.get(key) ?? 0
    const prevAmount = byPrev.get(key) ?? 0
    return {
      categoryId: key === '__none__' ? null : key,
      name: cat?.name ?? 'Kategorisiz',
      color: cat?.color ?? '#8C8C8C',
      amount,
      prevAmount,
      yearAmount: byYear.get(key) ?? 0,
      change: pctChange(amount, prevAmount),
    }
  }

  const rows = [...byCur.keys()].map(rowFor).filter(r => r.amount > 0)
  rows.sort((a, b) => b.amount - a.amount)

  const increases = rows
    .filter(r => r.amount - r.prevAmount > 0 && r.prevAmount > 0)
    .sort((a, b) => (b.amount - b.prevAmount) - (a.amount - a.prevAmount))
    .slice(0, 3)

  const largestExpenses = curTxs
    .filter(t => t.type === 'expense' && !t.icon)
    .sort((a, b) => baseAmount(b) - baseAmount(a))
    .slice(0, 5)

  return {
    current, previous, lastYear, partial, daysCounted, daysInMonth,
    dailyAvgExpense: daysCounted > 0 ? current.expense / daysCounted : 0,
    txCount: curTxs.filter(t => t.type !== 'transfer').length,
    categories: rows,
    increases,
    largestExpenses,
  }
}
