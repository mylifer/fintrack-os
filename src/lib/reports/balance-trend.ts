import { format, parseISO, startOfMonth, endOfMonth, differenceInDays, addMonths, addDays } from 'date-fns'
import { tr } from 'date-fns/locale'
import { getAssetPrice, computeHoldings } from '@/store/investment.store'
import { excludeFuture, calcNetWorth, calcNetRaw, buildDebtBurdenSeries } from '@/lib/utils/calculations'
import { baseAmount, fromBaseTry } from '@/lib/utils/fx'
import type { TrendPoint } from '@/components/reports/_BalanceTrendChart'
import type { Account, Transaction, PriceData, InvestmentTransaction, TefasFundPrice, Debt } from '@/types'

// Raporlar sayfasının "Net Varlık / Hesap Bakiye Trendi" serisi (reports/page.tsx'ten taşındı).

export function buildTrendData(
  accounts: Account[],
  allTransactions: Transaction[],
  dateRange: { from: string; to: string },
  selectedAccountId: string,
  prices: PriceData | null,
  investTxs: InvestmentTransaction[],
  fundPrices: Record<string, TefasFundPrice>,
  debts: Debt[],
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
    // Yükümlülük: "Net Varlık" başlık/kartlarıyla aynı kural — her snapshot
    // O TARİHTEKİ kalan borçla arındırılır (bkz. buildDebtBurdenSeries).
    const burden = buildDebtBurdenSeries(debts, postedTxs, snaps.map(sn => sn.snap))
    let upper: string | null = null  // bir sonraki (daha yeni) snapshot — pencere üst sınırı
    for (let i = snaps.length - 1; i >= 0; i--) {
      const { label, snap } = snaps[i]
      nw -= calcNetRaw(postedTxs.filter(t => t.date > snap && (upper === null || t.date <= upper)))
      if (prices) {
        nw -= investTxs
          .filter(t => { const d = t.date.slice(0, 10); return d > snap && (upper === null || d <= upper) })
          .reduce((s, t) => s + (t.type === 'buy' ? 1 : -1) * t.quantity * getAssetPrice(t.asset, prices, fundPrices), 0)
      }
      pts[i] = { label, balance: nw - burden[i] }
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
