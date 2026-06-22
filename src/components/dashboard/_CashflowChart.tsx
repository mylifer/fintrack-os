'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

interface Props {
  data: DataPoint[]
  selectedPeriod: MonthYear
}

export default function CashflowBarChart({ data, selectedPeriod }: Props) {
  return (
    <div className="px-2 py-4 h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 0" stroke="#1A2840" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#4A6080' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: '#0E1826',
              border: '1px solid #1A2840',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
            formatter={(v) => [formatCompact(Number(v)), '']}
            labelStyle={{ color: '#C0CCDD', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}
          />
          <Bar dataKey="income" name="Gelir" fill="#34D399" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.my.month === selectedPeriod.month && entry.my.year === selectedPeriod.year
                  ? '#34D399' : '#1A3830'
                }
              />
            ))}
          </Bar>
          <Bar dataKey="expense" name="Gider" fill="#F87171" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.my.month === selectedPeriod.month && entry.my.year === selectedPeriod.year
                  ? '#F87171' : '#2A1820'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
