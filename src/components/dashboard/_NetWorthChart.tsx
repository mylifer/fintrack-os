'use client'

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  netWorth: number
  my: MonthYear
}

interface Props {
  data: DataPoint[]
  selectedPeriod: MonthYear
}

export default function NetWorthLineChart({ data, selectedPeriod }: Props) {
  const allValues  = data.map(d => d.netWorth)
  const minVal     = Math.min(...allValues)
  const maxVal     = Math.max(...allValues)
  const padding    = Math.max(Math.abs(maxVal - minVal) * 0.15, 1000)
  const domainMin  = minVal - padding
  const domainMax  = maxVal + padding

  return (
    <div className="px-2 py-4 h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="#0EA5E9" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 0" stroke="#1A2840" vertical={false} />

          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#4A6080' }}
            axisLine={false}
            tickLine={false}
          />

          <YAxis hide domain={[domainMin, domainMax]} />

          <Tooltip
            contentStyle={{
              background: '#0E1826',
              border: '1px solid #1A2840',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
            formatter={(v) => [formatCompact(Number(v)), 'Net Varlık']}
            labelStyle={{ color: '#C0CCDD', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}
          />

          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="#0EA5E9"
            strokeWidth={2}
            fill="url(#nwFill)"
            dot={(props) => {
              const { cx, cy, payload } = props
              const isSelected =
                payload.my.month === selectedPeriod.month &&
                payload.my.year  === selectedPeriod.year
              if (!isSelected) return <g key={props.key} />
              return (
                <circle
                  key={props.key}
                  cx={cx} cy={cy} r={5}
                  fill="#0EA5E9" stroke="#0E1826" strokeWidth={2}
                />
              )
            }}
            activeDot={{ r: 4, fill: '#0EA5E9', stroke: '#0E1826', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
