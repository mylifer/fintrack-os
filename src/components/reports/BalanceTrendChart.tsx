import dynamic from 'next/dynamic'
import type { TrendPoint } from './_BalanceTrendChart'

const Inner = dynamic(
  () => import('./_BalanceTrendChart').then(m => ({ default: m.BalanceTrendChartInner })),
  {
    ssr: false,
    loading: () => (
      <div className="px-4 pt-4 pb-2" style={{ height: 252 }}>
        <div className="w-full h-[200px] bg-gradient-to-t from-transparent to-[#E8E8E8]/60 animate-pulse rounded-lg" />
      </div>
    ),
  }
)

export function BalanceTrendChart({ data }: { data: TrendPoint[] }) {
  return <Inner data={data} />
}
