import { useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { ChevronLeft } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { sumBy } from '@/lib/utils/money'

export type CategorySlice = {
  categoryId: string | null   // null = uncategorized
  name: string
  amount: number
  percent: number
  color: string
}

/* "Diğer" = tek sayfaya sığmayan kategorilerin toplama dilimi. Gerçek bir
   kategori değil (defterde karşılığı yok) → drill-down hedefi de olamaz;
   tıklanınca bir sonraki sayfaya (kendi alt kırılımına) inilir. */
const OTHER_ID  = '__other__'
const PAGE_SIZE = 8

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
        {slice.categoryId === OTHER_ID && (
          <div className="text-muted-foreground/70 mt-1">Alt kırılım için tıkla</div>
        )}
      </div>
    </>
  )
}

interface Props {
  data: CategorySlice[]
  activeIndex: number | null
  onSliceClick: (slice: CategorySlice, index: number) => void
  /** "Diğer" kırılımına inip çıkarken çağrılır — activeIndex görünen diliminin
   *  sırasına göre olduğundan, sayfa değişince dışarıdaki seçim bayatlar. */
  onDrillChange?: () => void
  emptyMessage?: string
}

export function CategoryDonutChartInner({ data, activeIndex, onSliceClick, onDrillChange, emptyMessage }: Props) {
  // "Diğer" kırılımının başlangıç sırası (0 = kök görünüm). Kategori sayısı
  // sonradan azalırsa (dönem/hesap filtresi) bayat offset kök görünüme kırpılır.
  const [offset, setOffset] = useState(0)

  if (data.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
        {emptyMessage ?? 'Bu dönemde gider kaydedilmemiş'}
      </div>
    )
  }

  const safeOffset = offset < data.length ? offset : 0

  // Görünen sayfanın 8 dilimi + kalanı "Diğer" olarak TEK dilimde. Recharts yay
  // açılarını verilen dilimler üzerinden normalize eder; kalan kategoriler
  // çizilmezse görünen yaylar etiketlerindeki yüzdeden büyük olur ve merkezdeki
  // Toplam ile dilimler tutmaz → yüzdeler de merkezdeki toplamla AYNI kovaya
  // (bu seviyede gösterilen + "Diğer"e giren tüm dilimler) göre hesaplanır.
  // Kökte bu kova tüm veri olduğundan yüzdeler gelen değerlerle birebir aynıdır.
  const page = data.slice(safeOffset, safeOffset + PAGE_SIZE)
  const rest = data.slice(safeOffset + PAGE_SIZE)
  const bucketTotal = sumBy(data.slice(safeOffset), d => d.amount)
  const pct = (amount: number) => (bucketTotal > 0 ? (amount / bucketTotal) * 100 : 0)

  const top: CategorySlice[] = [
    ...page.map(s => ({ ...s, percent: pct(s.amount) })),
    ...(rest.length === 0 ? [] : [{
      categoryId: OTHER_ID,
      name:       'Diğer',
      amount:     sumBy(rest, d => d.amount),
      percent:    pct(sumBy(rest, d => d.amount)),
      color:      '#9CA3AF',
    }]),
  ]
  const totalLabel = formatCurrency(bucketTotal)

  const goTo = (next: number) => {
    setOffset(next)
    onDrillChange?.()   // dışarıdaki index tabanlı seçim bu sayfada geçersiz
  }

  const handlePieClick = (pieData: any, index: number) => {
    const slice = pieData as CategorySlice
    // "Diğer" toplama dilimi — kendi drill-down hedefi yok, alt kırılımını aç.
    if (slice.categoryId === OTHER_ID) { goTo(safeOffset + PAGE_SIZE); return }
    onSliceClick(slice, index)
  }

  return (
    <div>
      {safeOffset > 0 && (
        <div className="px-5 pt-3 flex items-center gap-2 min-w-0">
          <button
            onClick={() => goTo(safeOffset - PAGE_SIZE)}
            className="flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors -ml-1"
          >
            <ChevronLeft size={13} />
            Geri
          </button>
          <span className="text-[11px] text-muted-foreground/70 truncate">
            Diğer · kalan {data.length - safeOffset} kategori
          </span>
        </div>
      )}

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
              onClick={() => handlePieClick(slice, i)}
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
              {slice.categoryId === OTHER_ID && (
                <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 leading-none">›</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
