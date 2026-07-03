import dynamic from 'next/dynamic'
import type { CategoryTrendPoint } from './_CategoryTrendChart'

export type { CategoryTrendPoint }

const Inner = dynamic(
  () => import('./_CategoryTrendChart').then(m => ({ default: m.CategoryTrendChartInner })),
  {
    ssr: false,
    loading: () => (
      <div className="pt-1 pb-2">
        <div className="w-full bg-muted animate-pulse rounded-lg" style={{ height: 160 }} />
      </div>
    ),
  }
)

export function CategoryTrendChart({ data, color }: { data: CategoryTrendPoint[]; color: string }) {
  return <Inner data={data} color={color} />
}
