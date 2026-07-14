'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts'
import { formatCompact, formatCurrency, formatAxisCompact } from '@/lib/utils/currency'
import { formatDate, formatDateShort } from '@/lib/utils/date'
import type { ForecastPoint } from '@/lib/utils/forecast'

interface ChartRow {
  date: string
  balance: number
  label: string      // axis tick
  fullLabel: string  // tooltip
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: ChartRow }[]
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { fullLabel, balance } = payload[0].payload
  const negative = balance < 0
  return (
    <div className="rounded-xl border border-border bg-background/95 backdrop-blur px-3.5 py-2.5 shadow-xl text-xs min-w-[120px]">
      <p className="text-muted-foreground mb-1.5 font-medium">{fullLabel}</p>
      <p className={`text-sm font-semibold tabular-nums ${negative ? 'text-destructive' : ''}`}>
        {formatCurrency(balance)}
      </p>
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
}

export default function ForecastAreaChart({ points, shortfallDate }: Props) {
  if (points.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        Tahmin için aktif tekrarlayan işlem gerekli
      </div>
    )
  }

  const data: ChartRow[] = points.map(p => ({
    date:      p.date,
    balance:   p.balance,
    label:     formatDateShort(p.date),
    fullLabel: formatDate(p.date),
  }))

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
            dataKey="label"
            tickLine={false}
            axisLine={false}
            dy={6}
            interval="preserveStartEnd"
            minTickGap={28}
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
              x={shortfallRow.label}
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
