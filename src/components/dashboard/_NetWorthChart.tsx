'use client'

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'

export interface NWDataPoint {
  label: string      // axis tick  ("Oca" or "Oca '23")
  fullLabel: string  // tooltip    ("Ocak 2023")
  netWorth: number
  delta: number      // change vs. previous month
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

interface Props {
  data: NWDataPoint[]
}

export default function NetWorthLineChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
        Grafik için en az 2 aylık veri gerekli
      </div>
    )
  }

  // Smart tick interval: show ~6-8 labels regardless of data length
  const tickInterval = Math.max(0, Math.ceil(data.length / 7) - 1)

  // Y domain with breathing room
  const values = data.map(d => d.netWorth)
  const minVal  = Math.min(...values)
  const maxVal  = Math.max(...values)
  const range   = maxVal - minVal || Math.abs(maxVal) || 10_000
  const pad     = range * 0.12
  const yMin    = Math.floor((Math.min(0, minVal) - pad) / 1000) * 1000
  const yMax    = Math.ceil((maxVal + pad) / 1000) * 1000
  const showRef = yMin < 0  // reference line at 0 only if chart dips negative

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 62, left: 0, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="currentColor"
          strokeOpacity={0.07}
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          dy={8}
          interval={tickInterval}
          className="text-[11px] fill-muted-foreground"
        />
        <YAxis
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={58}
          tickCount={5}
          domain={[yMin, yMax]}
          tickFormatter={v => formatCompact(v)}
          className="text-[11px] fill-muted-foreground"
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
  )
}
