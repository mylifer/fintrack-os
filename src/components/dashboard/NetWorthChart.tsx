'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { useTransactionStore, useAccountStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcNetRaw, excludeFuture } from '@/lib/utils/calculations'
import { getAssetPrice, computeHoldings } from '@/store/investment.store'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/types'
import type { NWDataPoint } from './_NetWorthChart'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

type Range = 'weekly' | 'monthly' | 'yearly' | 'all'

const RANGES: { key: Range; label: string }[] = [
  { key: 'weekly',  label: 'Haftalık'      },
  { key: 'monthly', label: 'Aylık'         },
  { key: 'yearly',  label: 'Yıllık'        },
  { key: 'all',     label: 'Tüm Zamanlar'  },
]

// Aralık seçimi YALNIZCA gösterilen pencereyi belirler; veri her zaman günlük
// çözünürlükte kalır (tooltip'te gün gün değişim görünür).
const RANGE_DAYS: Record<Range, number | null> = {
  weekly: 7, monthly: 30, yearly: 365, all: null,
}

const TREND_LABEL: Record<Range, string> = {
  weekly: 'son 7 günde', monthly: 'son 30 günde', yearly: 'son 1 yılda', all: 'tüm zamanlarda',
}

// Local date string YYYY-MM-DD (avoids UTC offset issues)
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface DayPoint { date: string; netWorth: number; delta: number }

export function NetWorthChart() {
  const [range, setRange] = useState<Range>('all')

  const allTransactions = useTransactionStore(s => s.transactions)
  // Bakiye artık gelecek tarihli işlemleri içermiyor — geriye dönük yürüyüş de
  // aynı kümede (sadece işlenmiş işlemler) yapılmalı, yoksa geçmiş günler kayar.
  const transactions = useMemo(() => excludeFuture(allTransactions), [allTransactions])
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices       = useInvestmentStore(s => s.prices)
  const fundPrices   = useInvestmentStore(s => s.fundPrices)
  const investTxs    = useInvestmentStore(s => s.transactions)
  const investValue  = useMemo(
    () => prices ? computeHoldings(investTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0) : 0,
    [investTxs, prices, fundPrices],
  )

  const currentNW = calcNetWorth(accounts, prices) + investValue

  // Günlük tam geçmiş — bugünden ilk işleme GÜN GÜN geriye yürür. Aylık/haftalık
  // kova yok; aralıklar bu diziden kesit alır. Tooltip delta'sı böylece her
  // aralıkta gerçek gün-gün değişimdir.
  const dailyData = useMemo<DayPoint[]>(() => {
    // Tek geçişte gün bazında kovalama — gün başına tüm defteri filtrelemek yerine
    const txByDay     = new Map<string, Transaction[]>()
    const investByDay = new Map<string, typeof investTxs>()
    let earliest: string | null = null

    for (const tx of transactions) {
      const key = tx.date.slice(0, 10)
      const bucket = txByDay.get(key)
      if (bucket) bucket.push(tx); else txByDay.set(key, [tx])
      if (!earliest || key < earliest) earliest = key
    }
    for (const tx of investTxs) {
      const key = tx.date.slice(0, 10)
      const bucket = investByDay.get(key)
      if (bucket) bucket.push(tx); else investByDay.set(key, [tx])
      if (!earliest || key < earliest) earliest = key
    }
    if (!earliest) return []

    const todayStr = localDateStr(new Date())
    const days: string[] = []
    const cur = parseLocalDate(earliest)
    while (localDateStr(cur) <= todayStr) {
      days.push(localDateStr(cur))
      cur.setDate(cur.getDate() + 1)
    }

    const points: DayPoint[] = new Array(days.length)
    let nw = currentNW

    for (let i = days.length - 1; i >= 0; i--) {
      const key = days[i]
      // Günün noktası = gün SONU bakiyesi; sonra günün neti çıkarılıp önceki güne geçilir
      points[i] = { date: key, netWorth: Math.round(nw * 100) / 100, delta: 0 }

      // Ham net (mutabakat DAHİL) — mutabakat kayıtları ham bakiyeyi gerçekten oynattı
      nw -= calcNetRaw(txByDay.get(key) ?? [])

      if (prices) {
        const investDelta = (investByDay.get(key) ?? [])
          .reduce((sum, tx) => {
            const unitPrice    = getAssetPrice(tx.asset, prices, fundPrices)
            const currentValue = tx.quantity * unitPrice
            return tx.type === 'buy' ? sum - currentValue : sum + currentValue
          }, 0)
        nw += investDelta
      }
    }

    for (let i = 1; i < points.length; i++) {
      points[i].delta = Math.round((points[i].netWorth - points[i - 1].netWorth) * 100) / 100
    }

    return points
  }, [transactions, currentNW, investTxs, prices, fundPrices])

  const { data, tickInterval, trendLabel } = useMemo(() => {
    const windowDays = RANGE_DAYS[range]
    const window = windowDays ? dailyData.slice(-windowDays) : dailyData

    // ≤40 nokta: her güne "12 Tem" etiketi; üstü: yalnızca ay başları etiketlenir
    const monthLabels = window.length > 40
    const withYear    = window.length > 366
    const seenMonths  = new Set<string>()

    const data = window.map((p): NWDataPoint => {
      const d = parseLocalDate(p.date)
      const fullLabel = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
      let label = ''
      if (!monthLabels) {
        label = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
      } else {
        const monthKey = p.date.slice(0, 7)
        if (!seenMonths.has(monthKey)) {
          seenMonths.add(monthKey)
          label = d.toLocaleDateString('tr-TR', { month: 'short' }) + (withYear ? ` '${p.date.slice(2, 4)}` : '')
        }
      }
      return { label, fullLabel, netWorth: p.netWorth, delta: p.delta }
    })

    return {
      data,
      tickInterval: monthLabels ? 0 : Math.max(0, Math.ceil(window.length / 8) - 1),
      trendLabel: TREND_LABEL[range],
    }
  }, [dailyData, range])

  const first   = data[0]?.netWorth ?? currentNW
  const trend   = currentNW - first
  const pct     = first !== 0 ? (trend / Math.abs(first)) * 100 : 0
  const up      = trend >= 0
  const hasData = data.length >= 2

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Varlık</p>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums leading-none">
            {formatCurrency(currentNW)}
          </p>
          {hasData && trend !== 0 && (
            <div className={`text-right shrink-0 ${up ? 'text-green-500' : 'text-destructive'}`}>
              <p className="text-sm font-semibold tabular-nums">
                {up ? '+' : ''}{formatCompact(trend)}
              </p>
              <p className="text-xs opacity-75">
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{trendLabel}</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Chart data={data} tickInterval={tickInterval} />
      </CardContent>
    </Card>
  )
}
