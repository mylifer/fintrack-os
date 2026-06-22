import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'

export type CashFlowPoint = {
  label: string
  income: number
  expense: number
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const income  = (payload.find((p: any) => p.dataKey === 'income')?.value  ?? 0) as number
  const expense = (payload.find((p: any) => p.dataKey === 'expense')?.value ?? 0) as number
  const net = income - expense
  return (
    <div className="bg-surface border border-line rounded-xl shadow-lg px-4 py-3 text-xs min-w-[148px]">
      <div className="font-semibold text-ink mb-2 pb-2 border-b border-line">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Gelir</span>
        <span className="font-semibold tabular text-ok">{formatCompact(income)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-1">
        <span className="text-muted">Gider</span>
        <span className="font-semibold tabular text-danger">{formatCompact(expense)}</span>
      </div>
      <div className={`flex items-center justify-between gap-4 mt-2 pt-2 border-t border-line ${net >= 0 ? 'text-ok' : 'text-danger'}`}>
        <span className="text-muted">Net</span>
        <span className="font-bold tabular">{net >= 0 ? '+' : ''}{formatCompact(net)}</span>
      </div>
    </div>
  )
}

export function CashFlowBarChartInner({ data }: { data: CashFlowPoint[] }) {
  return (
    <div className="px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barGap={3} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#1A2840" />
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
            width={56}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#0B1120', radius: 4 }} />
          <Bar dataKey="income"  name="Gelir" fill="#34D399" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" name="Gider" fill="#F87171" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
