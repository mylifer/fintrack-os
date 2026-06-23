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
    <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 text-xs min-w-[148px]">
      <div className="font-semibold text-foreground mb-2 pb-2 border-b border-border">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Gelir</span>
        <span className="font-semibold tabular-nums text-green-600">{formatCompact(income)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-1">
        <span className="text-muted-foreground">Gider</span>
        <span className="font-semibold tabular-nums text-destructive">{formatCompact(expense)}</span>
      </div>
      <div className={`flex items-center justify-between gap-4 mt-2 pt-2 border-t border-border ${net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
        <span className="text-muted-foreground">Net</span>
        <span className="font-normal tabular-nums">{net >= 0 ? '+' : ''}{formatCompact(net)}</span>
      </div>
    </div>
  )
}

export function CashFlowBarChartInner({ data }: { data: CashFlowPoint[] }) {
  return (
    <div className="px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barGap={3} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#e4e4e7" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={v => formatCompact(v as number)}
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)', radius: 4 }} />
          <Bar dataKey="income"  name="Gelir" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expense" name="Gider" fill="#dc2626" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
