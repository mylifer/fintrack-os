import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '@/lib/utils/currency'

export type CategorySlice = {
  categoryId: string | null   // null = uncategorized
  name: string
  amount: number
  percent: number
  color: string
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const slice = payload[0].payload as CategorySlice
  return (
    <>
      <style>{`@keyframes rpt-fadein{from{opacity:0}to{opacity:1}}`}</style>
      <div
        key={slice.name}
        className="bg-card border border-border rounded-xl shadow-lg px-3 py-2 text-xs pointer-events-none"
        style={{ animation: 'rpt-fadein 140ms ease-out' }}
      >
        <div className="font-semibold text-foreground">{slice.name}</div>
        <div className="text-foreground tabular font-semibold mt-0.5">{formatCurrency(slice.amount)}</div>
        <div className="text-muted-foreground">{slice.percent.toFixed(1)}%</div>
      </div>
    </>
  )
}

interface Props {
  data: CategorySlice[]
  activeIndex: number | null
  onSliceClick: (slice: CategorySlice, index: number) => void
}

export function CategoryDonutChartInner({ data, activeIndex, onSliceClick }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
        Bu dönemde gider kaydedilmemiş
      </div>
    )
  }

  const top        = data.slice(0, 8)
  const totalLabel = formatCurrency(data.reduce((s, d) => s + d.amount, 0))

  const handlePieClick = (pieData: any, index: number) => {
    onSliceClick(pieData as CategorySlice, index)
  }

  return (
    <div>
      <div className="px-4">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={top}
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={88}
              dataKey="amount"
              nameKey="name"
              paddingAngle={2}
              strokeWidth={0}
              onClick={handlePieClick}
              style={{ cursor: 'pointer' }}
            >
              {top.map((slice, i) => (
                <Cell
                  key={i}
                  fill={slice.color}
                  opacity={activeIndex !== null && activeIndex !== i ? 0.3 : 1}
                  stroke={activeIndex === i ? '#fff' : 'transparent'}
                  strokeWidth={activeIndex === i ? 2 : 0}
                />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip />}
              isAnimationActive={false}
              wrapperStyle={{ transition: 'none' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Summary line — below chart, no overlap with tooltip */}
      <div className="px-5 pb-3 text-center -mt-1">
        {activeIndex !== null && top[activeIndex] ? (
          <div className="flex items-center justify-center gap-2">
            <span
              className="text-[13px] font-black tabular leading-tight"
              style={{ color: top[activeIndex].color }}
            >
              {formatCurrency(top[activeIndex].amount)}
            </span>
            <span className="text-[10px] text-muted-foreground tabular">
              {top[activeIndex].percent.toFixed(1)}%
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">Toplam</span>
            <span className="text-[13px] font-black text-foreground tabular leading-tight">{totalLabel}</span>
          </div>
        )}
      </div>

      {/* Legend — clickable */}
      <div className="px-5 pb-5 grid grid-cols-2 gap-x-5 gap-y-1.5">
        {top.map((slice, i) => {
          const isActive  = activeIndex === i
          const isFaded   = activeIndex !== null && !isActive
          return (
            <button
              key={i}
              onClick={() => onSliceClick(slice, i)}
              className={[
                'flex items-center gap-2 min-w-0 rounded-lg px-1.5 py-1 -mx-1.5 text-left transition-colors',
                isActive  ? 'bg-muted/50' : 'hover:bg-accent',
                isFaded   ? 'opacity-40'   : '',
              ].join(' ')}
            >
              <span
                className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 transition-all ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                style={{ background: slice.color, '--tw-ring-color': slice.color } as React.CSSProperties}
              />
              <span className={`text-[11px] font-medium truncate flex-1 ${isActive ? 'text-foreground' : 'text-foreground/70'}`}>
                {slice.name}
              </span>
              <span className="text-[10px] text-muted-foreground tabular flex-shrink-0">
                {slice.percent.toFixed(0)}%
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
