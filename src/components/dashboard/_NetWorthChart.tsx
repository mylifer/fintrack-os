'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'

export interface NWDataPoint {
  label: string      // axis tick — empty string = invisible tick
  fullLabel: string  // tooltip ("Ocak 2024")
  netWorth: number
  delta: number
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: NWDataPoint }[]
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { fullLabel, netWorth, delta } = payload[0].payload
  return (
    <div className="rounded-xl border border-border bg-background/95 backdrop-blur px-3.5 py-2.5 shadow-xl text-xs min-w-[120px]">
      <p className="text-muted-foreground mb-1.5 font-medium">{fullLabel}</p>
      <p className="text-sm font-semibold tabular-nums">{formatCurrency(netWorth)}</p>
      {delta !== 0 && (
        <p className={`mt-1 tabular-nums font-medium ${delta > 0 ? 'text-green-500' : 'text-destructive'}`}>
          {delta > 0 ? '+' : ''}{formatCompact(delta)}
        </p>
      )}
    </div>
  )
}

// Returns tick values as multiples of 50K covering [minVal, maxVal], capped at 6 ticks
function niceYTicks(minVal: number, maxVal: number): number[] {
  const BASE = 50_000
  const lo = Math.floor(minVal / BASE) * BASE
  const hi = Math.ceil(maxVal / BASE) * BASE
  const rawSteps = Math.round((hi - lo) / BASE) + 1
  // Scale step up in multiples of BASE so we never exceed 6 ticks
  const mult = Math.max(1, Math.ceil(rawSteps / 6))
  const step = BASE * mult
  const lo2 = Math.floor(minVal / step) * step
  const hi2 = Math.ceil(maxVal / step) * step
  const ticks: number[] = []
  for (let v = lo2; v <= hi2; v += step) ticks.push(v)
  return ticks
}

interface Props {
  data: NWDataPoint[]
  tickInterval?: number
}

export default function NetWorthLineChart({ data, tickInterval = 0 }: Props) {
  if (data.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        Grafik için en az 2 aylık veri gerekli
      </div>
    )
  }

  const values = data.map(d => d.netWorth)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const ticks  = niceYTicks(minVal, maxVal)
  const showRef = ticks[0] < 0

  return (
    <div className="w-full overflow-hidden">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
          <CartesianGrid
            vertical={false}
            stroke="currentColor"
            strokeOpacity={0.07}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            dy={6}
            interval={tickInterval}
            padding={{ left: 16, right: 16 }}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          <YAxis
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={44}
            ticks={ticks}
            domain={[ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1]}
            tickFormatter={v => formatCompact(v)}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          {showRef && (
            <ReferenceLine
              y={0}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeDasharray="4 4"
            />
          )}
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.12, strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="netWorth"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--primary)',
              stroke: 'var(--background)',
              strokeWidth: 2.5,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
