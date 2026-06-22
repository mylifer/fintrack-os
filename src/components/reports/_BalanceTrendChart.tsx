import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'

export type TrendPoint = {
  label: string
  balance: number
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value as number
  return (
    <div className="bg-surface border border-line rounded-xl shadow-lg px-4 py-3 text-xs">
      <div className="font-semibold text-ink mb-1">{label}</div>
      <div className={`font-bold tabular text-sm ${value >= 0 ? 'text-ok' : 'text-danger'}`}>
        {value < 0 ? '−' : ''}{formatCompact(Math.abs(value))}
      </div>
    </div>
  )
}

export function BalanceTrendChartInner({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-muted">
        Yeterli veri yok
      </div>
    )
  }

  const hasNegative = data.some(d => d.balance < 0)

  return (
    <div className="px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rpt_grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#00C896" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#00C896" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#F0F0F0" />
          {hasNegative && (
            <ReferenceLine y={0} stroke="#E0E0E0" strokeWidth={1} strokeDasharray="4 2" />
          )}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#4A6080', fontFamily: 'inherit' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={v => formatCompact(v as number)}
            tick={{ fontSize: 10, fill: '#4A6080', fontFamily: 'inherit' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#00C896"
            strokeWidth={2}
            fill="url(#rpt_grad)"
            dot={data.length <= 14 ? { fill: '#00C896', r: 3, strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: '#00C896', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

