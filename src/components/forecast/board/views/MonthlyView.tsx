'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { EXPENSE_COLOR, INCOME_COLOR, monthlyBuckets, type MonthBucket, type ForecastViewProps } from '../shared'

/**
 * Görünüm — Aylık Şerit
 * "Hangi ay sıkışık?" görünümü: her ay tek satır, ortadaki eksenden sola gider,
 * sağa gelir çubuğu. Çubuklar TÜM aylar için aynı ölçekte, o yüzden aylar
 * gözle kıyaslanabilir. Sağda ayın neti ve ay sonu bakiyesi; üstte ay sonu
 * bakiyelerinin ince seyir çizgisi. Satıra tıklamak o ayın işlemlerini açar.
 */
export function MonthlyView({ points, events, todayStr, horizonEnd }: ForecastViewProps) {
  const buckets = useMemo(
    () => monthlyBuckets(points, events, todayStr, horizonEnd),
    [points, events, todayStr, horizonEnd],
  )
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  const scale = Math.max(1, ...buckets.map(b => Math.max(b.income, b.expense)))

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <span className="text-sm font-semibold text-foreground/90">Ay Ay Nakit Akışı</span>
        <span className="text-xs text-muted-foreground">{buckets.length} ay · çubuklar ortak ölçekte</span>
      </div>

      {/* Ay sonu bakiyelerinin seyri — çubukların anlatmadığı birikimli yön */}
      <div className="px-5 pt-4">
        <div className="text-[10px] font-medium tracking-wide uppercase text-muted-foreground mb-1">
          Ay sonu bakiye seyri
        </div>
        <Sparkline buckets={buckets} start={points[0]?.balance ?? 0} />
      </div>

      <CardContent className="p-5 pt-3 flex flex-col">
        {/* Kolon başlıkları — çubuk alanı gider | gelir olarak ikiye bölünür */}
        <div className="flex items-center gap-3 px-2 pb-2 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">
          <span className="w-24 flex-shrink-0">Ay</span>
          <span className="flex-1 flex items-center justify-between">
            <span>← Gider</span>
            <span>Gelir →</span>
          </span>
          <span className="w-24 text-right flex-shrink-0">Net</span>
          <span className="w-28 text-right flex-shrink-0 hidden sm:block">Ay Sonu</span>
        </div>

        {buckets.map(b => {
          const isOpen = open.has(b.key)
          const expenseW = (b.expense / scale) * 50
          const incomeW  = (b.income  / scale) * 50
          return (
            <div key={b.key} className="border-t border-border/40 first:border-t-0">
              <button
                type="button"
                onClick={() => toggle(b.key)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-accent transition-colors text-left"
              >
                <span className="w-24 flex-shrink-0 min-w-0">
                  <span className="block text-[13px] font-medium text-foreground/85 capitalize truncate">
                    {b.label.split(' ')[0]}
                  </span>
                  <span className="block text-[10px] text-muted-foreground tabular-nums">{b.key.slice(0, 4)}</span>
                </span>

                {/* Iraksak çubuk: ortada sıfır ekseni */}
                <span className="flex-1 relative h-5">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-3 rounded-l-sm"
                    style={{ right: '50%', width: `${expenseW}%`, background: EXPENSE_COLOR, opacity: 0.85 }}
                  />
                  <span
                    className="absolute top-1/2 -translate-y-1/2 h-3 rounded-r-sm"
                    style={{ left: '50%', width: `${incomeW}%`, background: INCOME_COLOR, opacity: 0.85 }}
                  />
                </span>

                <span className={`w-24 text-right flex-shrink-0 text-[13px] tabular-nums font-medium ${b.net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {b.net >= 0 ? '+' : '−'}{formatCompact(Math.abs(b.net))}
                </span>
                <span className={`w-28 text-right flex-shrink-0 text-[13px] tabular-nums hidden sm:block ${b.endBalance < 0 ? 'text-destructive font-semibold' : 'text-foreground/70'}`}>
                  {formatCompact(b.endBalance)}
                </span>
              </button>

              {isOpen && (
                <div className="pl-2 pr-2 pb-3 flex flex-col">
                  <div className="flex items-baseline gap-3 px-2 pb-1 text-[11px] text-muted-foreground tabular-nums">
                    <span className="text-green-600">+{formatCurrency(b.income)}</span>
                    <span className="text-destructive">−{formatCurrency(b.expense)}</span>
                    {b.minBalance < 0 && (
                      <span className="text-destructive">en düşük {formatCompact(b.minBalance)}</span>
                    )}
                  </div>
                  {b.events.length === 0 ? (
                    <p className="px-2 py-1 text-[12px] text-muted-foreground">Bu ayda planlı işlem yok.</p>
                  ) : (
                    b.events.map((e, i) => (
                      <div key={i} className="flex items-center gap-3 px-2 py-1 rounded-lg hover:bg-accent/60 transition-colors">
                        <span className="w-24 flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {formatDate(e.date, 'd MMM')}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-[12px] text-foreground/80">{e.name}</span>
                        <span className={`w-24 text-right flex-shrink-0 text-[12px] tabular-nums ${e.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                          {e.type === 'income' ? '+' : '−'}{formatCompact(e.amountTry)}
                        </span>
                        <span className={`w-28 text-right flex-shrink-0 text-[12px] tabular-nums hidden sm:block ${e.balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {formatCompact(e.balanceAfter)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** Ay sonu bakiyelerinin ince seyir çizgisi (bugünkü bakiyeden başlar). */
function Sparkline({ buckets, start }: { buckets: MonthBucket[]; start: number }) {
  const values = [start, ...buckets.map(b => b.endBalance)]
  if (values.length < 2) return null
  const W = 100
  const H = 28
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo || 1
  const x = (i: number) => (i / (values.length - 1)) * W
  const y = (v: number) => H - ((v - lo) / span) * H
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const zeroY = y(0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-10" aria-hidden>
      <path d={area} fill="var(--primary)" fillOpacity={0.12} />
      {lo < 0 && (
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--destructive)" strokeOpacity={0.5} strokeWidth={0.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
