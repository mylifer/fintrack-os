import { memo, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Rectangle,
  type RectangleProps,
} from 'recharts'
import type { SubscriptionMonth } from '@/lib/utils/subscriptions'
import { formatCurrency, formatAxisCompact, formatWhole } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' } as const
const MAX_TICKS = 8

/** X ekseni etiketleri: en fazla ~8, son ay (içinde bulunulan) daima etiketli.
 *  Seyreltme boş etiketle değil açık `ticks` listesiyle — dataKey `month`
 *  benzersiz kalır, tooltip doğru ayı bulur. */
function axisTicks(months: string[]): string[] {
  const step = Math.ceil(months.length / MAX_TICKS)
  return months.filter((_, i) => (months.length - 1 - i) % step === 0)
}

function MonthTooltip({ active, payload }: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: SubscriptionMonth }>
}) {
  const m = active ? payload?.[0]?.payload : undefined
  if (!m) return null
  const top = m.services.slice(0, 3)
  const rest = m.services.length - top.length
  return (
    <div className="bg-card border border-border rounded-lg shadow-md px-4 py-3 text-xs min-w-[180px]">
      <div className="flex items-baseline justify-between gap-4 mb-2 pb-2 border-b border-border">
        <span className="font-semibold text-foreground">{formatDate(`${m.month}-01`, 'MMMM yyyy')}</span>
        <span className="font-semibold tabular-nums text-foreground">{formatCurrency(m.totalTry)}</span>
      </div>
      {top.length === 0 ? (
        <div className="text-muted-foreground">Ödeme yok</div>
      ) : (
        <>
          {top.map(s => (
            <div key={s.key} className="flex items-center justify-between gap-4 mt-1 first:mt-0">
              <span className="text-muted-foreground truncate max-w-[120px]">{s.name}</span>
              <span className="tabular-nums text-foreground">{formatCurrency(s.totalTry)}</span>
            </div>
          ))}
          {rest > 0 && <div className="mt-1 text-muted-foreground">+{rest} servis daha</div>}
        </>
      )}
    </div>
  )
}

export const SubscriptionMonthlyChartInner = memo(function SubscriptionMonthlyChartInner({
  data,
  selected,
  onSelect,
}: {
  data: SubscriptionMonth[]
  selected: string
  onSelect: (month: string) => void
}) {
  const ticks = useMemo(() => axisTicks(data.map(d => d.month)), [data])
  const spansYears = data.length > 0 && data[0].month.slice(0, 4) !== data[data.length - 1].month.slice(0, 4)

  // Tıklama grafik seviyesinde: boş (₺0) aylar da seçilebilsin.
  const handleClick = (state: { activeLabel?: unknown; activeTooltipIndex?: unknown } | null) => {
    const label = state?.activeLabel
    const idx = state?.activeTooltipIndex
    const month = typeof label === 'string'
      ? label
      : idx != null ? data[Number(idx)]?.month : undefined
    if (month) onSelect(month)
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={data}
        margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
        barCategoryGap="24%"
        onClick={handleClick}
        className="cursor-pointer"
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          ticks={ticks}
          interval={0}
          tickFormatter={v => formatDate(`${v}-01`, spansYears ? 'MMM yy' : 'MMM')}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          // Abonelik tutarları çoğunlukla binler düzeyinde: kısaltma ₺1.050 ve
          // ₺1.400'ü aynı "₺1B" etiketine düşürüyordu.
          tickFormatter={v => (Math.abs(v as number) < 10_000 ? formatWhole(v as number) : formatAxisCompact(v as number))}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          content={<MonthTooltip />}
          cursor={{ fill: 'var(--foreground)', fillOpacity: 0.05, radius: 4 }}
        />
        <Bar
          dataKey="totalTry"
          name="Abonelik"
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
          shape={(props: unknown) => {
            const p = props as RectangleProps & { payload?: SubscriptionMonth }
            return (
              <Rectangle
                {...p}
                fill="var(--primary)"
                fillOpacity={p.payload?.month === selected ? 1 : 0.4}
              />
            )
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
})
