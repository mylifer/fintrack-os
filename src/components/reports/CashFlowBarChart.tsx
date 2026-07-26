import dynamic from 'next/dynamic'
import type { CashFlowPoint, CashFlowChartType } from './_CashFlowBarChart'

const SKELETON_H = [65, 40, 80, 55, 70, 45, 75, 50]

const Inner = dynamic(
  () => import('./_CashFlowBarChart').then(m => ({ default: m.CashFlowBarChartInner })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-end gap-2 px-4 pb-2" style={{ height: 252 }}>
        {SKELETON_H.map((h, i) => (
          <div key={i} className="flex-1 flex gap-0.5 items-end">
            <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h}%` }} />
            <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h * 0.65}%` }} />
          </div>
        ))}
      </div>
    ),
  }
)

export function CashFlowBarChart({
  data,
  onBarClick,
  chartType,
  incomeColor,
  expenseColor,
  barGap,
  barCategoryGap,
  maxBarSize,
}: {
  data: CashFlowPoint[]
  onBarClick?: (point: CashFlowPoint) => void
  chartType?: CashFlowChartType
  incomeColor?: string
  expenseColor?: string
  barGap?: number
  barCategoryGap?: string | number
  maxBarSize?: number
}) {
  return (
    <Inner
      data={data}
      onBarClick={onBarClick}
      chartType={chartType}
      incomeColor={incomeColor}
      expenseColor={expenseColor}
      barGap={barGap}
      barCategoryGap={barCategoryGap}
      maxBarSize={maxBarSize}
    />
  )
}
