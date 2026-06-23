'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import type { AssetGroup, PricePoint } from '@/app/api/prices/history/route'

// ── Constants ──────────────────────────────────────────────────────

const COLORS: Record<AssetGroup, string> = {
  GOLD: '#d97706',
  USD:  '#2563eb',
  EUR:  '#7c3aed',
  GBP:  '#0891b2',
}

const RAW_PRICE_LABEL: Record<AssetGroup, string> = {
  GOLD: 'Gram fiyatı',
  USD:  'USD/TRY kuru',
  EUR:  'EUR/TRY kuru',
  GBP:  'GBP/TRY kuru',
}

// Each series is independently normalized to its own vertical band on a shared Y-axis.
// This gives both lines the same visual amplitude regardless of their absolute magnitudes.
// Portfolio occupies the upper band, unit price the lower band, with a gap between.
const UPPER_MIN = 55   // portfolio band: 55–100
const UPPER_MAX = 100
const LOWER_MIN = 0    // unit-price band: 0–45
const LOWER_MAX = 45
// gap = 45–55 (10 units) keeps the lines visually separated

const PRICE_COLOR = '#16a34a' // green-600

const TR_MONTHS = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']

function fmtAxisDate(iso: string) {
  const p = iso.split('-')
  return `${parseInt(p[2])} ${TR_MONTHS[parseInt(p[1]) - 1] ?? ''}`
}

function fmtTooltipDate(iso: string) {
  const p = iso.split('-')
  return `${parseInt(p[2])} ${TR_MONTHS[parseInt(p[1]) - 1] ?? ''}`
}

function fmtPrice(n: number) {
  return n.toLocaleString('tr-TR', { maximumFractionDigits: n >= 1000 ? 0 : 2 })
}

const CHART_H = 170

// ── Period ─────────────────────────────────────────────────────────

type Period = '1H' | '1A' | '3A' | '1Y' | 'MAX'

const PERIODS: { key: Period; days: number | null }[] = [
  { key: '1H',  days: 7   },
  { key: '1A',  days: 30  },
  { key: '3A',  days: 90  },
  { key: '1Y',  days: 365 },
  { key: 'MAX', days: null },
]

// ── Public types ───────────────────────────────────────────────────

export interface BuyPoint {
  date:        string
  description: string
  totalCost:   number
}

interface Props {
  asset:         AssetGroup
  from:          string
  label:         string
  currentValue?: number
  currentPrice?: number
  buyPoints?:    BuyPoint[]
}

// ── Chart data row ─────────────────────────────────────────────────

interface ChartRow {
  date:         string
  value:        number   // indexed portfolio (PORTFOLIO_BASE at t₀)
  rawPrice:     number   // indexed unit price (PRICE_BASE at t₀)
  realValue:    number   // actual portfolio TRY — used in tooltip
  realRawPrice: number   // actual unit price TRY — used in tooltip
}

// ── Component ─────────────────────────────────────────────────────

export function PriceHistoryChart({
  asset, from, label, currentValue, currentPrice, buyPoints = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartW, setChartW] = useState(400)

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

  // ── Period ──────────────────────────────────────────────────────
  const [period, setPeriod] = useState<Period>('3A')

  const fetchFrom = useMemo(() => {
    if (period === 'MAX') return from
    const days = PERIODS.find(p => p.key === period)!.days!
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    return d.toISOString().split('T')[0]
  }, [from, period])

  const buyDatesStr = useMemo(
    () => buyPoints.filter(b => b.date >= fetchFrom).map(b => b.date).join(','),
    [buyPoints, fetchFrom],
  )

  const buyByDate = useMemo(() => {
    const map = new Map<string, BuyPoint[]>()
    for (const bp of buyPoints) {
      if (bp.date < fetchFrom) continue
      const arr = map.get(bp.date) ?? []
      map.set(bp.date, [...arr, bp])
    }
    return map
  }, [buyPoints, fetchFrom])

  // ── Fetch ───────────────────────────────────────────────────────
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    const params = new URLSearchParams({ asset, from: fetchFrom })
    if (buyDatesStr) params.set('buyDates', buyDatesStr)
    fetch(`/api/prices/history?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: PricePoint[]) => { setPriceHistory(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [asset, fetchFrom, buyDatesStr])

  // ── Chart data ───────────────────────────────────────────────────
  // Each series is independently min-max normalized to its own vertical band,
  // so both lines use the full visual amplitude of their band.
  // realValue / realRawPrice are stored alongside for the tooltip.
  const chartData = useMemo((): ChartRow[] => {
    if (!priceHistory.length || !currentPrice || !currentValue) return []

    const today = new Date().toISOString().split('T')[0]

    // Build raw real values first (including today's anchor)
    const allPrices     = priceHistory.map(p => p.price)
    const allPortfolios = priceHistory.map(p => currentValue * (p.price / currentPrice))

    // Include today's real-time price in domain computation
    if (!priceHistory.some(p => p.date === today)) {
      allPrices.push(currentPrice)
      allPortfolios.push(currentValue)
    } else {
      allPrices[allPrices.length - 1]     = currentPrice
      allPortfolios[allPortfolios.length - 1] = currentValue
    }

    const minP = Math.min(...allPortfolios), maxP = Math.max(...allPortfolios)
    const minR = Math.min(...allPrices),     maxR = Math.max(...allPrices)

    const scaleP = (v: number) =>
      maxP === minP ? (UPPER_MIN + UPPER_MAX) / 2
                    : UPPER_MIN + ((v - minP) / (maxP - minP)) * (UPPER_MAX - UPPER_MIN)

    const scaleR = (v: number) =>
      maxR === minR ? (LOWER_MIN + LOWER_MAX) / 2
                    : LOWER_MIN + ((v - minR) / (maxR - minR)) * (LOWER_MAX - LOWER_MIN)

    const makeRow = (date: string, price: number, realVal: number): ChartRow => ({
      date,
      value:        scaleP(realVal),
      rawPrice:     scaleR(price),
      realValue:    realVal,
      realRawPrice: price,
    })

    const data = priceHistory.map(p =>
      makeRow(p.date, p.price, currentValue * (p.price / currentPrice))
    )

    const todayRow = makeRow(today, currentPrice, currentValue)
    const last = data[data.length - 1]
    if (!last || last.date < today) {
      data.push(todayRow)
    } else {
      data[data.length - 1] = todayRow
    }

    return data
  }, [priceHistory, currentValue, currentPrice])

  // ── Derived display values ───────────────────────────────────────
  const color  = COLORS[asset]
  const gradId = `grad-${asset}`

  const firstRealValue = chartData[0]?.realValue
  const pct  = firstRealValue && currentValue
    ? ((currentValue - firstRealValue) / firstRealValue) * 100
    : null
  const up = pct !== null && pct >= 0

  const lastRaw  = currentPrice
  const firstRaw = chartData[0]?.realRawPrice
  const rawPct   = firstRaw && lastRaw ? ((lastRaw - firstRaw) / firstRaw) * 100 : null
  const rawUp    = rawPct !== null && rawPct >= 0

  return (
    <Card className="overflow-hidden gap-0 py-0">

      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5">
            {label}
          </span>

          {currentValue ? (
            <div className="text-[22px] font-black tabular tracking-tight text-foreground leading-none">
              ₺{fmtPrice(currentValue)}
            </div>
          ) : loading ? (
            <div className="h-7 w-28 bg-muted rounded animate-pulse" />
          ) : null}

          {pct !== null && (
            <div className={`text-[11px] font-bold tabular mt-1 ${up ? 'text-green-600' : 'text-destructive'}`}>
              {up ? '↑' : '↓'} {Math.abs(pct).toFixed(2)}% bu dönemde
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex gap-px flex-shrink-0 mt-0.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={[
                'px-2 py-1 text-[9px] font-bold rounded transition-colors leading-none',
                period === p.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground/60',
              ].join(' ')}
            >
              {p.key}
            </button>
          ))}
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────── */}
      {!loading && chartData.length > 1 && (
        <div className="px-5 pb-2 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <svg width="20" height="8">
              <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" />
            </svg>
            <span className="text-[9px] text-muted-foreground font-medium">Portföy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="20" height="8">
              <line x1="0" y1="4" x2="20" y2="4" stroke={PRICE_COLOR} strokeWidth="1.5" strokeDasharray="4 2" />
            </svg>
            <span className="text-[9px] text-muted-foreground font-medium">
              {RAW_PRICE_LABEL[asset]}
              {lastRaw && (
                <span className="ml-1 tabular">
                  ₺{fmtPrice(lastRaw)}
                  {rawPct !== null && (
                    <span className={rawUp ? ' text-green-600' : ' text-destructive'}>
                      {' '}{rawUp ? '↑' : '↓'}{Math.abs(rawPct).toFixed(2)}%
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ── Chart ─────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{ width: '100%', height: CHART_H }}>

        {loading && (
          <div className="flex items-end px-5 pb-4 gap-1" style={{ height: CHART_H }}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-muted rounded-sm animate-pulse"
                style={{ height: `${32 + Math.sin(i * 0.8) * 22 + 28}%`, animationDelay: `${i * 55}ms` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center" style={{ height: CHART_H }}>
            <span className="text-[11px] text-muted-foreground">Veri alınamadı</span>
          </div>
        )}

        {!loading && !error && chartData.length > 1 && (
          <AreaChart
            width={chartW}
            height={CHART_H}
            data={chartData}
            margin={{ top: 4, right: 12, left: 12, bottom: 0 }}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            </defs>

            {/* Single axis covering both indexed series */}
            <YAxis domain={['auto', 'auto']} width={0} />

            <XAxis
              dataKey="date"
              tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'inherit' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmtAxisDate}
              interval="preserveStartEnd"
              minTickGap={52}
            />

            <Tooltip
              cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.25 }}
              content={({ active, payload, label: lbl }) => {
                if (!active || !payload?.length) return null
                const date = lbl as string
                const buys = buyByDate.get(date)

                // Payload carries indexed display values; pull real values from the data row
                const row = chartData.find(r => r.date === date)

                return (
                  <div style={{
                    background: '#ffffff', border: '1px solid #e4e4e7',
                    borderRadius: 6, padding: '8px 12px', minWidth: 155,
                  }}>
                    <div style={{ fontSize: 9, color: '#71717a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {fmtTooltipDate(date)}
                    </div>

                    {row && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <svg width="12" height="6"><line x1="0" y1="3" x2="12" y2="3" stroke={color} strokeWidth="2" /></svg>
                          <div>
                            <div style={{ fontSize: 8, color: '#71717a', marginBottom: 1 }}>Portföy</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b', fontVariantNumeric: 'tabular-nums' }}>
                              ₺{fmtPrice(row.realValue)}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <svg width="12" height="6"><line x1="0" y1="3" x2="12" y2="3" stroke={PRICE_COLOR} strokeWidth="1.5" strokeDasharray="3 2" /></svg>
                          <div>
                            <div style={{ fontSize: 8, color: '#71717a', marginBottom: 1 }}>{RAW_PRICE_LABEL[asset]}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', fontVariantNumeric: 'tabular-nums' }}>
                              ₺{fmtPrice(row.realRawPrice)}
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {buys && (
                      <div style={{ borderTop: '1px solid #e4e4e7', marginTop: 7, paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {buys.map((b, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <span style={{ fontSize: 9, marginTop: 1 }}>🛒</span>
                            <div>
                              <div style={{ fontSize: 9, color: '#71717a', fontWeight: 600, lineHeight: 1.3 }}>{b.description}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color }}>
                                ₺{fmtPrice(b.totalCost)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              }}
            />

            {/* Portfolio — solid filled area, buy markers */}
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradId})`}
              dot={(props: any) => {
                const { cx = 0, cy = 0, payload } = props
                if (!buyByDate.has(payload?.date)) {
                  return <circle key={`nd-${payload?.date}`} cx={cx} cy={cy} r={0} fill="none" />
                }
                return (
                  <g key={`buy-${payload.date}`}>
                    <circle cx={cx} cy={cy} r={10} fill={color} fillOpacity={0.12} />
                    <circle cx={cx} cy={cy} r={4}  fill={color} stroke="#ffffff" strokeWidth={2} />
                  </g>
                )
              }}
              activeDot={(props: any) => {
                const { cx = 0, cy = 0, payload } = props
                const isBuy = buyByDate.has(payload?.date)
                return (
                  <g key={`active-v-${payload?.date}`}>
                    {isBuy && <circle cx={cx} cy={cy} r={11} fill={color} fillOpacity={0.2} />}
                    <circle cx={cx} cy={cy} r={isBuy ? 5 : 4} fill={color} stroke="#ffffff" strokeWidth={2} />
                  </g>
                )
              }}
            />

            {/* Unit price — dashed green line, no fill */}
            <Area
              type="monotone"
              dataKey="rawPrice"
              stroke={PRICE_COLOR}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              fill="none"
              dot={false}
              activeDot={{ r: 3, fill: PRICE_COLOR, stroke: 'none' }}
            />
          </AreaChart>
        )}

        {!loading && !error && chartData.length <= 1 && (
          <div className="flex items-center justify-center" style={{ height: CHART_H }}>
            <span className="text-[11px] text-muted-foreground">Yeterli veri yok</span>
          </div>
        )}
      </div>
    </Card>
  )
}
