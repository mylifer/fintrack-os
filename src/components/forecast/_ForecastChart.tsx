'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts'
import { addDays, format, parseISO } from 'date-fns'
import { formatCompact, formatCurrency, formatAxisCompact } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { ForecastEvent, ForecastPoint } from '@/lib/utils/forecast'

const TOOLTIP_EVENT_CAP = 4

interface ChartRow {
  date: string
  balance: number
  fullLabel: string  // tooltip
  events: ForecastEvent[]  // occurrences landing on this date
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: ChartRow }[]
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { fullLabel, balance, events } = payload[0].payload
  const negative = balance < 0
  const shown = events.slice(0, TOOLTIP_EVENT_CAP)
  const hidden = events.length - shown.length
  return (
    <div className="rounded-xl border border-border bg-background/95 backdrop-blur px-3.5 py-2.5 shadow-xl text-xs min-w-[150px] max-w-[240px]">
      <p className="text-muted-foreground mb-1.5 font-medium">{fullLabel}</p>
      <p className={`text-sm font-semibold tabular-nums ${negative ? 'text-destructive' : ''}`}>
        {formatCurrency(balance)}
      </p>
      {shown.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1">
          {shown.map((e, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground truncate">{e.name}</span>
              <span className={`tabular-nums font-medium flex-shrink-0 ${e.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                {e.type === 'income' ? '+' : '−'}{formatCompact(e.amountTry)}
              </span>
            </div>
          ))}
          {hidden > 0 && (
            <p className="text-muted-foreground/70">+{hidden} işlem daha</p>
          )}
        </div>
      )}
    </div>
  )
}

// Tick values covering [min, max] and always including 0, capped at ~6 ticks.
function niceYTicks(minVal: number, maxVal: number): number[] {
  const lo0 = Math.min(0, minVal)
  const hi0 = Math.max(0, maxVal)
  const span = hi0 - lo0 || 1
  const rawStep = span / 5
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = niceNorm * mag
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.ceil(hi0 / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

interface Props {
  points: ForecastPoint[]
  shortfallDate: string | null
  events?: ForecastEvent[]
  horizonEnd?: string  // yyyy-MM-dd — extend the daily series to this date
}

export default function ForecastAreaChart({ points, shortfallDate, events = [], horizonEnd }: Props) {
  if (points.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        Tahmin için aktif tekrarlayan işlem gerekli
      </div>
    )
  }

  const eventsByDate = new Map<string, ForecastEvent[]>()
  for (const e of events) {
    const list = eventsByDate.get(e.date)
    if (list) list.push(e)
    else eventsByDate.set(e.date, [e])
  }

  // Densify the sparse event-day points into one row per calendar day, carrying
  // the balance forward on quiet days, so the tooltip walks the chart gün gün.
  const lastPointDate = points[points.length - 1].date
  const endDate = horizonEnd && horizonEnd > lastPointDate ? horizonEnd : lastPointDate
  const data: ChartRow[] = []
  let idx = 0
  let balance = points[0].balance
  for (let d = parseISO(points[0].date); ; d = addDays(d, 1)) {
    const date = format(d, 'yyyy-MM-dd')
    while (idx < points.length && points[idx].date <= date) {
      balance = points[idx].balance
      idx++
    }
    data.push({
      date,
      balance,
      fullLabel: formatDate(date),
      events: eventsByDate.get(date) ?? [],
    })
    if (date >= endDate) break
  }

  // One tick per month: the first data point of each month on the axis.
  const seenMonths = new Set<string>()
  const monthTicks: string[] = []
  for (const d of data) {
    const key = d.date.slice(0, 7)
    if (!seenMonths.has(key)) {
      seenMonths.add(key)
      monthTicks.push(d.date)
    }
  }

  const values = data.map(d => d.balance)
  const ticks  = niceYTicks(Math.min(...values), Math.max(...values))
  const showZeroRef = ticks[0] < 0

  const shortfallRow = shortfallDate ? data.find(d => d.date === shortfallDate) : undefined

  return (
    <div className="w-full px-4">
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--primary)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.07} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            dy={6}
            ticks={monthTicks}
            interval={0}
            tickFormatter={d => formatDate(d as string, 'MMMM')}
            padding={{ left: 16, right: 16 }}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          <YAxis
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={52}
            ticks={ticks}
            domain={[ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1]}
            tickFormatter={v => formatAxisCompact(v as number)}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          {showZeroRef && (
            <ReferenceLine y={0} stroke="var(--destructive)" strokeOpacity={0.45} strokeDasharray="4 4" />
          )}
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.12, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#forecastFill)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--background)', strokeWidth: 2.5 }}
            isAnimationActive={false}
          />
          {shortfallRow && (
            <ReferenceDot
              x={shortfallRow.date}
              y={shortfallRow.balance}
              r={5}
              fill="var(--destructive)"
              stroke="var(--background)"
              strokeWidth={2}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
