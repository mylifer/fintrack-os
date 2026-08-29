'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { dailyBalances, groupByDay, monthlyBuckets, type ForecastViewProps } from '../shared'

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

/** Pazartesi başlangıçlı hafta indeksi (0 = Pzt). */
function mondayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/**
 * Görünüm — Takvim
 * "Ne zaman?" sorusunun görünümü: her ay bir ızgara, her gün bir hücre.
 * Hücrede o günün net hareketi ve o günden sonraki tahmini bakiye durur;
 * bakiyenin eksiye düştüğü günler kırmızıya boyanır, böylece sıkışık haftalar
 * (maaş öncesi, kart ödemesi günü) ilk bakışta görünür.
 * Bir güne tıklamak o günün işlemlerini ayın altında açar.
 */
export function CalendarView({ points, events, todayStr, horizonEnd }: ForecastViewProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const buckets = useMemo(
    () => monthlyBuckets(points, events, todayStr, horizonEnd),
    [points, events, todayStr, horizonEnd],
  )
  const daily = useMemo(() => dailyBalances(points, horizonEnd), [points, horizonEnd])
  const byDay = useMemo(() => groupByDay(events), [events])

  return (
    <div className="flex flex-col gap-5">
      {buckets.map(b => {
        const total = daysInMonth(b.key)
        const lead = mondayIndex(`${b.key}-01`)
        const cells: (string | null)[] = [
          ...Array.from({ length: lead }, () => null),
          ...Array.from({ length: total }, (_, i) => `${b.key}-${String(i + 1).padStart(2, '0')}`),
        ]
        while (cells.length % 7 !== 0) cells.push(null)
        // Tamamı geçmişte kalan haftalar düşer: içinde bulunduğumuz ay dört boş
        // satırla açılmasın (ufuk zaten bugünden başlıyor).
        const weeks: (string | null)[][] = []
        for (let w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7))
        const visibleWeeks = weeks.filter(week => week.some(d => d != null && d >= todayStr))
        const selectedInMonth = selected && selected.slice(0, 7) === b.key ? selected : null
        const selectedEvents = selectedInMonth ? byDay.get(selectedInMonth) ?? [] : []

        return (
          <Card key={b.key} className="overflow-hidden gap-0 py-0">
            {/* Ay başlığı: o ayın gelir / gider / net'i ve ay sonu bakiyesi */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground/90 capitalize">{b.label}</span>
              <div className="flex items-baseline gap-3 text-xs tabular-nums">
                <span className="text-green-600">+{formatCompact(b.income)}</span>
                <span className="text-destructive">−{formatCompact(b.expense)}</span>
                <span className="text-muted-foreground">
                  ay sonu{' '}
                  <span className={`font-semibold ${b.endBalance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                    {formatCompact(b.endBalance)}
                  </span>
                </span>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="grid grid-cols-7 border-b border-border/50">
                {WEEKDAYS.map(w => (
                  <div key={w} className="py-1.5 text-center text-[10px] font-medium tracking-wide uppercase text-muted-foreground">
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px bg-border/40">
                {visibleWeeks.flat().map((date, i) => {
                  if (!date) return <div key={i} className="bg-card min-h-[76px]" />
                  const inHorizon = date >= todayStr && date <= horizonEnd
                  const dayEvents = byDay.get(date) ?? []
                  const balance = daily.get(date)
                  const negative = balance != null && balance < 0
                  const isToday = date === todayStr
                  const isSelected = date === selectedInMonth
                  const net = dayEvents.reduce((s, e) => s + (e.type === 'income' ? e.amountTry : -e.amountTry), 0)
                  const weekend = i % 7 >= 5

                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={dayEvents.length === 0}
                      onClick={() => setSelected(prev => (prev === date ? null : date))}
                      className={[
                        'relative min-h-[76px] p-1.5 text-left transition-colors',
                        negative ? 'bg-destructive/10' : weekend ? 'bg-muted/40' : 'bg-card',
                        !inHorizon ? 'opacity-40' : '',
                        dayEvents.length > 0 ? 'hover:bg-accent cursor-pointer' : 'cursor-default',
                        isSelected ? 'ring-2 ring-inset ring-primary' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={[
                            'text-[11px] tabular-nums',
                            isToday
                              ? 'inline-flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground font-semibold'
                              : 'text-muted-foreground',
                          ].join(' ')}
                        >
                          {Number(date.slice(8))}
                        </span>
                        {net !== 0 && (
                          <span className={`text-[10px] tabular-nums font-semibold ${net > 0 ? 'text-green-600' : 'text-destructive'}`}>
                            {net > 0 ? '+' : '−'}{formatCompact(Math.abs(net))}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-col gap-0.5">
                        {dayEvents.slice(0, 2).map((e, j) => (
                          <span
                            key={j}
                            className={`block truncate text-[10px] leading-tight ${e.type === 'income' ? 'text-green-600/90' : 'text-destructive/90'}`}
                          >
                            {e.name}
                          </span>
                        ))}
                        {dayEvents.length > 2 && (
                          <span className="text-[10px] leading-tight text-muted-foreground">+{dayEvents.length - 2} işlem</span>
                        )}
                      </div>

                      {inHorizon && balance != null && dayEvents.length > 0 && (
                        <span
                          className={`absolute bottom-1 right-1.5 text-[10px] tabular-nums ${negative ? 'text-destructive font-semibold' : 'text-muted-foreground/70'}`}
                        >
                          {formatCompact(balance)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Seçili gün — o günün işlemleri ve işlem sonrası bakiye */}
              {selectedInMonth && selectedEvents.length > 0 && (
                <div className="border-t border-border/50 px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <span className="text-xs font-semibold text-foreground/90">{formatDate(selectedInMonth, 'd MMMM EEEE')}</span>
                    <button
                      onClick={() => setSelected(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Kapat
                    </button>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {selectedEvents.map((e, i) => (
                      <div key={i} className="flex items-center gap-3 py-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.type === 'income' ? 'bg-green-600' : 'bg-destructive'}`}
                        />
                        <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/80">{e.name}</span>
                        <span className={`text-[13px] tabular-nums font-medium ${e.type === 'income' ? 'text-green-600' : 'text-destructive'}`}>
                          {e.type === 'income' ? '+' : '−'}{formatCurrency(e.amountTry)}
                        </span>
                        <span className={`w-28 text-right text-[12px] tabular-nums ${e.balanceAfter < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {formatCurrency(e.balanceAfter)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
