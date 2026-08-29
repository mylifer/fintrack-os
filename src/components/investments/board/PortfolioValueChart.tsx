'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { chartGroupOf, fmtPct } from './shared'
import { buildPortfolioSeries } from './timeline'
import { useHistories, daysAgo, type HistorySpec } from './useAssetHistory'
import type { AssetRow } from './shared'
import type { InvestmentTransaction } from '@/types'

/* ── Birleşik portföy grafiği ────────────────────────────────────────────────
 * Varlık başına ayrı grafik yerine TEK seri: portföyün toplam değeri ve maliyet
 * bazı. İkisi de TL — tek eksen (iki farklı ölçeği tek eksene sıkıştıran çift
 * eksen kurgusu yok). Aradaki dolgu kar/zarardır.
 * ------------------------------------------------------------------------- */

const VALUE_COLOR = '#0891b2'   // portföy değeri
const COST_COLOR  = '#71717a'   // maliyet bazı (nötr — veri değil referans)
const CHART_H     = 220

type Period = '1A' | '3A' | '1Y' | 'MAX'
const PERIOD_DAYS: Record<Exclude<Period, 'MAX'>, number> = { '1A': 30, '3A': 90, '1Y': 365 }

const TR_MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']

// Etiket dataKey'i günlük olduğu için ay adı tek başına TEKRARLIYOR
// ("Haz Haz Haz"); kısa dönemlerde gün + ay, uzun dönemlerde ay + yıl yazılır.
function fmtAxis(iso: string, period: Period) {
  const [y, m, d] = iso.split('-').map(Number)
  if (period === '1A' || period === '3A') return `${d} ${TR_MONTHS[m - 1]}`
  return `${TR_MONTHS[m - 1]} ${String(y).slice(2)}`
}

function fmtFull(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${TR_MONTHS[m - 1]} ${y}`
}

export function PortfolioValueChart({
  rows, transactions, totalValue, totalCost, title = 'Portföy Değeri',
}: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  totalValue:   number
  totalCost:    number
  title?:       string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartW, setChartW] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setChartW(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [period, setPeriod] = useState<Period>('3A')

  const firstTxDate = useMemo(
    () => transactions.reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null),
    [transactions],
  )

  const from = period === 'MAX'
    ? (firstTxDate ?? daysAgo(1095))
    : daysAgo(PERIOD_DAYS[period])

  // Aynı seriyi iki varlık paylaşabilir (tüm altınlar GOLD serisini okur) —
  // tekilleştirilmezse aynı istek birden çok kez açılır.
  const specs = useMemo<HistorySpec[]>(() => {
    const seen = new Map<string, HistorySpec>()
    for (const r of rows) {
      const { group, fundCode } = chartGroupOf(r.asset)
      seen.set(`${group}|${fundCode ?? ''}`, { group, fundCode, from })
    }
    return [...seen.values()]
  }, [rows, from])

  const { series, loading, error } = useHistories(specs)

  const data = useMemo(() => buildPortfolioSeries({
    assets:       rows.map(r => r.asset),
    transactions,
    series,
    from,
    todayStr:     today(),
    todayValue:   totalValue,
    todayCost:    totalCost,
  }), [rows, transactions, series, from, totalValue, totalCost])

  // Eksen etiketleri: recharts her noktayı kategori sayar, ay adı biçimlendirmesi
  // aynı etiketi arka arkaya basıyordu. Etiketi BENZERSİZ olan ~8 tarih seçilip
  // ticks olarak veriliyor (bkz. recharts-duplicate-category).
  const ticks = useMemo(() => {
    if (data.length < 2) return undefined
    const stride = Math.max(1, Math.floor(data.length / 8))
    const seen = new Set<string>()
    const out: string[] = []
    for (let i = 0; i < data.length; i += stride) {
      const label = fmtAxis(data[i].date, period)
      if (seen.has(label)) continue
      seen.add(label)
      out.push(data[i].date)
    }
    return out
  }, [data, period])

  const first = data[0]
  const last  = data[data.length - 1]
  const periodPct = first && first.value > 0 && last ? ((last.value - first.value) / first.value) * 100 : null

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      {/* ── Başlık ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <span className="text-sm font-semibold text-foreground/90">{title}</span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-medium text-foreground" style={{ fontVariantNumeric: 'proportional-nums' }}>
              {formatCurrency(totalValue)}
            </span>
            {periodPct !== null && (
              <span className={`text-xs font-semibold tabular-nums ${periodPct >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                {fmtPct(periodPct)} <span className="text-muted-foreground font-normal">bu dönem</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60">
          {(['1A', '3A', '1Y', 'MAX'] as Period[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`px-2.5 h-6 rounded-lg text-[11px] font-semibold transition-colors ${
                period === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >{p}</button>
          ))}
        </div>
      </div>

      {/* ── Açıklama (iki seri → açıklama her zaman var) ───────────── */}
      <div className="flex items-center gap-4 px-5 pb-2">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
          <svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" stroke={VALUE_COLOR} strokeWidth="2" /></svg>
          Portföy değeri
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
          <svg width="14" height="6" aria-hidden><line x1="0" y1="3" x2="14" y2="3" stroke={COST_COLOR} strokeWidth="1.5" strokeDasharray="4 2" /></svg>
          Maliyet bazı {formatCompact(totalCost)}
        </span>
      </div>

      {/* ── Grafik ────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ width: '100%', height: CHART_H }} className="pb-2">
        {loading && (
          <div className="flex items-end px-5 pb-4 gap-1" style={{ height: CHART_H }}>
            {Array.from({ length: 22 }).map((_, i) => (
              <div key={i} className="flex-1 bg-muted rounded-sm animate-pulse"
                   style={{ height: `${34 + Math.sin(i * 0.7) * 20 + 26}%`, animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        )}

        {!loading && (error || data.length <= 1) && (
          <div className="flex items-center justify-center" style={{ height: CHART_H }}>
            <span className="text-[11px] text-muted-foreground">
              {error ? 'Fiyat geçmişi alınamadı' : 'Yeterli veri yok'}
            </span>
          </div>
        )}

        {!loading && !error && data.length > 1 && (
          <AreaChart width={chartW} height={CHART_H} data={data} margin={{ top: 8, right: 26, left: 26, bottom: 0 }}>
            <defs>
              <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={VALUE_COLOR} stopOpacity={0.20} />
                <stop offset="100%" stopColor={VALUE_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>

            <YAxis domain={['auto', 'auto']} width={0} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'inherit' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => fmtAxis(v, period)}
              ticks={ticks}
              interval={0}
            />

            <ReferenceLine y={0} stroke="transparent" />

            <Tooltip
              cursor={{ stroke: VALUE_COLOR, strokeWidth: 1, strokeOpacity: 0.3 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const row = payload[0]?.payload as { date: string; value: number; cost: number } | undefined
                if (!row) return null
                const pnl = row.value - row.cost
                const pct = row.cost > 0 ? (pnl / row.cost) * 100 : 0
                return (
                  <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md min-w-[168px]">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      {fmtFull(row.date)}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <svg width="12" height="6" aria-hidden><line x1="0" y1="3" x2="12" y2="3" stroke={VALUE_COLOR} strokeWidth="2" /></svg>
                      <span className="text-[9px] text-muted-foreground">Değer</span>
                      <span className="ml-auto text-xs font-semibold tabular-nums text-foreground">{formatCurrency(row.value)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="12" height="6" aria-hidden><line x1="0" y1="3" x2="12" y2="3" stroke={COST_COLOR} strokeWidth="1.5" strokeDasharray="3 2" /></svg>
                      <span className="text-[9px] text-muted-foreground">Maliyet</span>
                      <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">{formatCurrency(row.cost)}</span>
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-border/60 flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">K/Z</span>
                      <span className={`ml-auto text-xs font-semibold tabular-nums ${pnl >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {(pnl >= 0 ? '+' : '−') + formatCurrency(Math.abs(pnl))} · {fmtPct(pct)}
                      </span>
                    </div>
                  </div>
                )
              }}
            />

            <Area type="monotone" dataKey="value" stroke={VALUE_COLOR} strokeWidth={2}
                  fill="url(#pvGrad)" dot={false}
                  activeDot={{ r: 4, fill: VALUE_COLOR, stroke: 'var(--card)', strokeWidth: 2 }} />
            <Area type="monotone" dataKey="cost" stroke={COST_COLOR} strokeWidth={1.5}
                  strokeDasharray="5 3" fill="none" dot={false}
                  activeDot={{ r: 3, fill: COST_COLOR, stroke: 'none' }} />
          </AreaChart>
        )}
      </div>
    </div>
  )
}
