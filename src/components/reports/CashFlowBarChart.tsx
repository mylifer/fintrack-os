import dynamic from 'next/dynamic'
import type { CashFlowPoint } from './_CashFlowBarChart'

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

export function CashFlowBarChart({ data }: { data: CashFlowPoint[] }) {
  return <Inner data={data} />
}
