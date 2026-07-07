import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'

export type CategoryTrendPoint = {
  label: string
  amount: number
}

// Y ekseni etiketleri: dar (60px) alana sığması için gerçek "compact" gösterim
// (ör. 125.000 → "₺125 B", 1.200.000 → "₺1,2 Mn"). Tooltip tam değeri gösterir.
const AXIS_FORMATTER = new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 })
const formatAxis = (v: number) => `₺${AXIS_FORMATTER.format(v)}`

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value as number
  return (
    <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 text-xs">
      <div className="font-semibold text-foreground mb-1">{label}</div>
      <div className="font-normal tabular-nums text-sm text-destructive">
        {formatCompact(value)}
      </div>
    </div>
  )
}

export function CategoryTrendChartInner({ data, color }: { data: CategoryTrendPoint[]; color: string }) {
  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground">
        Yeterli veri yok
      </div>
    )
  }

  return (
    <div className="pt-1 pb-2">
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cattrend_grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e4e4e7" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={v => formatAxis(v as number)}
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="amount"
            stroke={color}
            strokeWidth={2}
            fill="url(#cattrend_grad)"
            dot={{ fill: color, r: 3, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
