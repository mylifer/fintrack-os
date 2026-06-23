import dynamic from 'next/dynamic'
import type { CategorySlice } from './_CategoryDonutChart'

const Inner = dynamic(
  () => import('./_CategoryDonutChart').then(m => ({ default: m.CategoryDonutChartInner })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center gap-4 py-6" style={{ minHeight: 340 }}>
        <div className="w-44 h-44 rounded-full border-[20px] border-border animate-pulse" />
        <div className="grid grid-cols-2 gap-2 px-6 w-full">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-muted rounded animate-pulse" />
          ))}
        </div>
      </div>
    ),
  }
)

interface Props {
  data: CategorySlice[]
  activeIndex: number | null
  onSliceClick: (slice: CategorySlice, index: number) => void
}

export function CategoryDonutChart({ data, activeIndex, onSliceClick }: Props) {
  return <Inner data={data} activeIndex={activeIndex} onSliceClick={onSliceClick} />
}
