'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompact } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { EXPENSE_COLOR, INCOME_COLOR, type ForecastViewProps } from '../shared'

const Chart = dynamic(() => import('@/components/forecast/_ForecastChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>
  ),
})

const INITIAL_EVENT_COUNT = 15

/**
 * Görünüm — Projeksiyon
 * Grafik önce gelir: bakiye eğrisi tüm ufku tek bakışta verir, altında
 * yaklaşan işlemler ve kalemlerin aylık etkisi. Sayfanın klasik düzeni.
 */
export function ProjectionView({
  chartPoints, chartEvents, events, drivers, shortfallDate, horizonEnd, todayStr, mode,
}: ForecastViewProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? events : events.slice(0, INITIAL_EVENT_COUNT)
  const maxDriver = drivers[0]?.monthlyEquivTry ?? 0

  return (
    <>
      {/* ── Bakiye eğrisi ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Bakiye Projeksiyonu</span>
          <span className="text-xs text-muted-foreground">
            {mode === 'cash' ? 'Nakit hesaplar + TEFAS fonları (₺)' : 'Tahmini bakiye, yatırımlar dahil (₺)'}
          </span>
        </div>
        <CardContent className="p-0 py-4">
          <Chart points={chartPoints} shortfallDate={shortfallDate} events={chartEvents} horizonEnd={horizonEnd} todayStr={todayStr} />
        </CardContent>
      </Card>

      {/* ── Yaklaşan işlemler ─────────────────────────────────────────── */}
      {events.length > 0 && (
        <Card className="overflow-hidden gap-0 py-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">Yaklaşan İşlemler</span>
            <span className="text-xs text-muted-foreground">{events.length} işlem</span>
          </div>
          <CardContent className="p-5 pt-3 flex flex-col">
            {visible.map((e, i) => {
              const income = e.type === 'income'
              const monthKey = e.date.slice(0, 7)
              const newMonth = i === 0 || visible[i - 1].date.slice(0, 7) !== monthKey
              return (
                <div key={i}>
                  {newMonth && (
                    <div className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground mt-3 mb-1.5 first:mt-0">
                      {formatDate(e.date, 'MMMM yyyy')}
                    </div>
                  )}
                  <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: income ? INCOME_COLOR : EXPENSE_COLOR }}
                    />
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] text-foreground/80 truncate">{e.name}</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">{formatDate(e.date)}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-[13px] tabular-nums font-medium ${income ? 'text-green-600' : 'text-destructive'}`}>
                          {income ? '+' : '−'}{formatCompact(e.amountTry)}
                        </div>
                        <div className={`text-[11px] tabular-nums ${e.balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {formatCompact(e.balanceAfter)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {events.length > INITIAL_EVENT_COUNT && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="mt-3 self-center px-4 py-1.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                {showAll ? 'Daha az göster' : `Tümünü göster (${events.length})`}
              </button>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Sağdaki ikinci satır, işlem sonrası tahmini bakiyeyi gösterir.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Aylık etki ────────────────────────────────────────────────── */}
      {drivers.length > 0 && (
        <Card className="overflow-hidden gap-0 py-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">Aylık Etki</span>
            <span className="text-xs text-muted-foreground">{drivers.length} kalem</span>
          </div>
          <CardContent className="p-5 flex flex-col gap-0.5">
            {drivers.map(d => {
              const width  = maxDriver > 0 ? (d.monthlyEquivTry / maxDriver) * 100 : 0
              const income = d.type === 'income'
              const barColor = income ? INCOME_COLOR : EXPENSE_COLOR
              return (
                <div key={d.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: barColor }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] text-foreground/80 truncate">{d.name}</span>
                      <span className={`text-[13px] tabular-nums font-medium flex-shrink-0 ${income ? 'text-green-600' : 'text-destructive'}`}>
                        {income ? '+' : '−'}{formatCompact(d.monthlyEquivTry)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, background: barColor }} />
                    </div>
                  </div>
                </div>
              )
            })}
            <p className="text-[11px] text-muted-foreground mt-2">
              Her işlemin aylığa çevrilmiş ortalama tutarı. Tahmin, işlemlerin gerçek tekrar tarihlerine göre hesaplanır.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}
