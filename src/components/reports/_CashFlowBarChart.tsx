import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatCompact, formatAxisCompact } from '@/lib/utils/currency'

export type CashFlowPoint = {
  label: string
  income: number
  expense: number
  /** Bu barın kapsadığı tarih aralığı — detay overlay'i bu aralığı okur. */
  from: string
  to: string
}

export type CashFlowChartType = 'bar' | 'line'

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

// Seri renkleri (--cf-income / --cf-expense) ve grid/eksen (--border,
// --muted-foreground) tema token'larıdır; açık/koyu temada otomatik uyum
// sağlar (bkz. globals.css).

// Ortak eksen bileşenleri — bar ve line grafik aynı ölçeği kullanır.
const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' } as const
// İade ağırlıklı bir dönemde gelir/gider toplamı negatife düşebilir;
// varsayılan [0, auto] domain negatif değerleri kırpar.
const Y_DOMAIN = [(dataMin: number) => Math.min(0, dataMin), 'auto'] as const

export function CashFlowBarChartInner({
  data,
  onBarClick,
  chartType = 'bar',
  incomeColor = 'var(--cf-income)',
  expenseColor = 'var(--cf-expense)',
}: {
  data: CashFlowPoint[]
  onBarClick?: (point: CashFlowPoint) => void
  chartType?: CashFlowChartType
  /** Bar/çizgi dolgu-vuruş rengi override — varsayılan nakit akışı yeşil/kırmızısı. */
  incomeColor?: string
  expenseColor?: string
}) {
  // Recharts Bar onClick, tıklanan noktanın payload'ını (label/from/to dahil)
  // döndürür. Payload doğrudan da spread edilmiş gelebilir; ikisini de karşıla.
  const handleClick = onBarClick
    ? (entry: unknown) => {
        const e = entry as { payload?: CashFlowPoint } | CashFlowPoint | null
        const p = (e && 'payload' in e ? e.payload : e) as CashFlowPoint | undefined
        if (p?.from && p?.to) onBarClick(p)
      }
    : undefined

  // Line modunda tıklama grafik seviyesinde yakalanır: aktif nokta indeksi
  // data dizisine eşlenir.
  const handleChartClick = onBarClick
    ? (state: any) => {
        const idx = state?.activeTooltipIndex
        const p = typeof idx === 'number' ? data[idx] : undefined
        if (p?.from && p?.to) onBarClick(p)
      }
    : undefined

  const commonAxes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="label"
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        domain={Y_DOMAIN as unknown as [number, number]}
        tickFormatter={v => formatAxisCompact(v as number)}
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
        width={56}
      />
      <Tooltip
        content={<CustomTooltip />}
        cursor={chartType === 'line'
          ? { stroke: 'var(--border)', strokeWidth: 1 }
          : { fill: 'var(--foreground)', fillOpacity: 0.05, radius: 4 }}
      />
    </>
  )

  return (
    <div className="px-4 pt-4 pb-2">
      <ResponsiveContainer width="100%" height={220}>
        {chartType === 'line' ? (
          <LineChart
            data={data}
            margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
            onClick={handleChartClick}
            className={onBarClick ? 'cursor-pointer' : undefined}
          >
            {commonAxes}
            <Line
              dataKey="income" name="Gelir" stroke={incomeColor} strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: incomeColor }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="expense" name="Gider" stroke={expenseColor} strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: expenseColor }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        ) : (
          <BarChart data={data} barGap={3} barCategoryGap="28%">
            {commonAxes}
            <Bar
              dataKey="income"  name="Gelir" fill={incomeColor} radius={[3, 3, 0, 0]} maxBarSize={28}
              onClick={handleClick}
              className={onBarClick ? 'cursor-pointer' : undefined}
            />
            <Bar
              dataKey="expense" name="Gider" fill={expenseColor} radius={[3, 3, 0, 0]} maxBarSize={28}
              onClick={handleClick}
              className={onBarClick ? 'cursor-pointer' : undefined}
            />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
