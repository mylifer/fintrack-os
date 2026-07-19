import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { formatCompact } from '@/lib/utils/currency'

export type TrendPoint = {
  label: string
  balance: number
}

// Eksen adımı: veri aralığını ~4 dilime bölüp 1/2/5×10ⁿ'e yuvarlar.
function niceStep(span: number): number {
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value as number
  return (
    <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 text-xs">
      <div className="font-semibold text-foreground mb-1">{label}</div>
      <div className={`font-normal tabular-nums text-sm ${value >= 0 ? 'text-green-600' : 'text-destructive'}`}>
        {value < 0 ? '−' : ''}{formatCompact(Math.abs(value))}
      </div>
    </div>
  )
}

export function BalanceTrendChartInner({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
        Yeterli veri yok
      </div>
    )
  }

  /* Y domain veriye zoom yapar: eski [0, auto] domain'i büyük bakiyelerdeki
     küçük dönem-içi hareketi düz çizgiye indiriyordu. Sınırlar nice adıma
     yuvarlanır; veri tam sınıra denk gelirse bir adım nefes payı eklenir. */
  const balances = data.map(d => d.balance)
  const dataMin  = Math.min(...balances)
  const dataMax  = Math.max(...balances)
  const span     = dataMax - dataMin
  const step     = niceStep(span > 0 ? span : Math.max(Math.abs(dataMax), 1))
  let yMin = Math.floor(dataMin / step) * step
  let yMax = Math.ceil(dataMax / step) * step
  if (yMin === dataMin) yMin -= step
  if (yMax === dataMax) yMax += step
  const ticks = Array.from(
    { length: Math.round((yMax - yMin) / step) + 1 },
    (_, i) => yMin + i * step,
  )

  /* Zoom'lu eksende adım binlik/milyonluk birimin altına inebilir; gereken
     kadar ondalık gösterilir (812.500 → ₺812,5B). */
  const tickLabel = (v: number) => {
    const abs  = Math.abs(v)
    const sign = v < 0 ? '-' : ''
    const unit   = abs >= 1_000_000 ? 1_000_000 : abs >= 1_000 ? 1_000 : 1
    const suffix = unit === 1_000_000 ? 'Mn' : unit === 1_000 ? 'B' : ''
    const decimals = step >= unit ? 0 : step >= unit / 10 ? 1 : 2
    const n = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: decimals }).format(abs / unit)
    return `${sign}₺${n}${suffix}`
  }

  return (
    <div className="px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rpt_grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#2563eb" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e4e4e7" />
          {yMin < 0 && yMax > 0 && (
            <ReferenceLine y={0} stroke="#d4d4d8" strokeWidth={1} strokeDasharray="4 2" />
          )}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            ticks={ticks}
            tickFormatter={v => tickLabel(v as number)}
            tick={{ fontSize: 11, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#2563eb"
            strokeWidth={2}
            fill="url(#rpt_grad)"
            dot={data.length <= 14 ? { fill: '#2563eb', r: 3, strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: '#2563eb', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
