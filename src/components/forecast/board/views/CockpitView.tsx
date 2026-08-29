'use client'

import { useMemo } from 'react'
import { parseISO } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { subMoney } from '@/lib/utils/money'
import { dailyBalances, groupByDay, type ForecastViewProps } from '../shared'
import type { ForecastEvent } from '@/lib/utils/forecast'

interface Week {
  start: string
  end: string
  net: number
  minBalance: number
  endBalance: number
  events: ForecastEvent[]
}

/** Ufku pazartesi başlangıçlı haftalara böler. */
function weekly(daily: Map<string, number>, byDay: Map<string, ForecastEvent[]>): Week[] {
  const days = [...daily.keys()].sort()
  if (days.length === 0) return []
  const out: Week[] = []
  let cur: Week | null = null
  for (const d of days) {
    const [y, m, dd] = d.split('-').map(Number)
    const isMonday = (new Date(y, m - 1, dd).getDay() + 6) % 7 === 0
    if (!cur || isMonday) {
      cur = { start: d, end: d, net: 0, minBalance: Infinity, endBalance: 0, events: [] }
      out.push(cur)
    }
    const balance = daily.get(d)!
    const events = byDay.get(d) ?? []
    cur.end = d
    cur.endBalance = balance
    cur.minBalance = Math.min(cur.minBalance, balance)
    cur.events.push(...events)
    for (const e of events) cur.net += e.type === 'income' ? e.amountTry : -e.amountTry
  }
  return out
}

/**
 * Görünüm — Kokpit
 * "Durum ne?" görünümü: liste değil ölçü. Üstte ufkun dört kritik sayısı
 * (en düşük bakiye ve tarihi, güvenli gün sayısı, ortalama aylık net, gelirin
 * gideri karşılama oranı), ortada hafta hafta ısı şeridi — her kutu bir hafta,
 * rengi o haftanın neti, altındaki kırmızı çizgi o hafta bakiyenin eksiye
 * düştüğünü söyler. Altta en ağır günler ve en büyük kalemler.
 */
export function CockpitView({ points, events, drivers, shortfallDate, todayStr, horizonEnd }: ForecastViewProps) {
  const daily  = useMemo(() => dailyBalances(points, horizonEnd), [points, horizonEnd])
  const byDay  = useMemo(() => groupByDay(events), [events])
  const weeks  = useMemo(() => weekly(daily, byDay), [daily, byDay])

  const startBalance = points[0]?.balance ?? 0
  const balances = [...daily.values()]
  const minBalance = balances.length ? Math.min(...balances) : startBalance
  const minDate = [...daily.entries()].find(([, v]) => v === minBalance)?.[0] ?? todayStr

  const totalIncome  = events.filter(e => e.type === 'income').reduce((s, e) => s + e.amountTry, 0)
  const totalExpense = events.filter(e => e.type === 'expense').reduce((s, e) => s + e.amountTry, 0)
  const coverage = totalExpense > 0 ? (totalIncome / totalExpense) * 100 : null
  const monthsSpan = Math.max(1, balances.length / 30.4375)
  const avgMonthlyNet = subMoney(totalIncome, totalExpense) / monthsSpan

  // Güvenli gün: bugünden ilk eksiye düşüşe kadar; hiç düşmüyorsa ufkun tamamı.
  const safeDays = shortfallDate
    ? Math.max(0, Math.round((parseISO(shortfallDate).getTime() - parseISO(todayStr).getTime()) / 86400000))
    : balances.length

  const maxWeekNet = Math.max(1, ...weeks.map(w => Math.abs(w.net)))

  // En ağır günler: net çıkışı en büyük 5 gün.
  const heaviest = useMemo(() => {
    const rows = [...byDay.entries()].map(([date, list]) => ({
      date,
      net: list.reduce((s, e) => s + (e.type === 'income' ? e.amountTry : -e.amountTry), 0),
      count: list.length,
      balance: daily.get(date) ?? 0,
      names: list.map(e => e.name),
    }))
    return rows.filter(r => r.net < 0).sort((a, b) => a.net - b.net).slice(0, 5)
  }, [byDay, daily])

  const topDrivers = drivers.slice(0, 6)
  const maxDriver = topDrivers[0]?.monthlyEquivTry ?? 0

  return (
    <div className="flex flex-col gap-5">
      {/* ── Dört kritik ölçü ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <Metric
          label="En düşük bakiye"
          value={formatCurrency(minBalance)}
          hint={formatDate(minDate)}
          tone={minBalance < 0 ? 'danger' : 'neutral'}
        />
        <Metric
          label="Güvenli gün"
          value={shortfallDate ? `${safeDays} gün` : 'Ufuk boyunca'}
          hint={shortfallDate ? `${formatDate(shortfallDate)} eksiye düşüş` : 'bakiye hiç eksiye düşmüyor'}
          tone={shortfallDate ? 'danger' : 'ok'}
        />
        <Metric
          label="Ortalama aylık net"
          value={`${avgMonthlyNet >= 0 ? '+' : '−'}${formatCompact(Math.abs(avgMonthlyNet))}`}
          hint="ufuk ortalaması"
          tone={avgMonthlyNet >= 0 ? 'ok' : 'danger'}
        />
        <Metric
          label="Gideri karşılama"
          value={coverage == null ? '—' : `%${Math.round(coverage)}`}
          hint={coverage == null ? 'planlı gider yok' : `${formatCompact(totalIncome)} / ${formatCompact(totalExpense)}`}
          tone={coverage == null ? 'neutral' : coverage >= 100 ? 'ok' : 'danger'}
        />
      </div>

      {/* ── Hafta hafta ısı şeridi ────────────────────────────────────── */}
      <Card className="overflow-hidden gap-0 py-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <span className="text-sm font-semibold text-foreground/90">Hafta Hafta</span>
          <span className="text-xs text-muted-foreground">{weeks.length} hafta · renk = haftanın neti</span>
        </div>
        <CardContent className="p-5">
          <div className="flex items-end gap-[3px]">
            {weeks.map(w => {
              const intensity = Math.abs(w.net) / maxWeekNet
              const positive = w.net > 0
              const bg = w.net === 0
                ? 'var(--muted)'
                : positive
                  ? `color-mix(in oklab, ${'#00C853'} ${Math.round(18 + intensity * 72)}%, transparent)`
                  : `color-mix(in oklab, ${'#FF1744'} ${Math.round(18 + intensity * 72)}%, transparent)`
              return (
                <div key={w.start} className="flex-1 min-w-[6px]">
                  <div
                    title={`${formatDate(w.start, 'd MMM')} – ${formatDate(w.end, 'd MMM')}\nnet ${w.net >= 0 ? '+' : '−'}${formatCompact(Math.abs(w.net))}\nhafta sonu ${formatCompact(w.endBalance)}`}
                    className="h-11 rounded-sm"
                    style={{ background: bg }}
                  />
                  <div className={`h-[3px] mt-[3px] rounded-full ${w.minBalance < 0 ? 'bg-destructive' : 'bg-transparent'}`} />
                </div>
              )
            })}
          </div>
          {/* Ay kılavuzu — haftanın ayı değiştiğinde etiket düşer */}
          <div className="flex gap-[3px] mt-1.5">
            {weeks.map((w, i) => {
              const newMonth = i === 0 || weeks[i - 1].start.slice(0, 7) !== w.start.slice(0, 7)
              return (
                <div key={w.start} className="flex-1 min-w-[6px] text-[9px] text-muted-foreground whitespace-nowrap overflow-visible">
                  {newMonth ? formatDate(w.start, 'MMM') : ''}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Kutunun altındaki kırmızı çizgi, o hafta içinde bakiyenin eksiye düştüğü anlamına gelir.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── En ağır günler ─────────────────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">En Ağır Günler</span>
            <span className="text-xs text-muted-foreground">net çıkış</span>
          </div>
          <CardContent className="p-5 pt-3 flex flex-col gap-0.5">
            {heaviest.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-2">Ufukta net çıkışı olan gün yok.</p>
            ) : heaviest.map(d => (
              <div key={d.date} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors">
                <span className="w-20 flex-shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {formatDate(d.date, 'd MMM')}
                </span>
                <span className="flex-1 min-w-0 truncate text-[12px] text-foreground/80">
                  {d.names.slice(0, 2).join(', ')}{d.count > 2 ? ` +${d.count - 2}` : ''}
                </span>
                <span className="w-24 text-right flex-shrink-0 text-[13px] tabular-nums font-medium text-destructive">
                  −{formatCompact(Math.abs(d.net))}
                </span>
                <span className={`w-24 text-right flex-shrink-0 text-[12px] tabular-nums hidden sm:block ${d.balance < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {formatCompact(d.balance)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── En büyük kalemler ──────────────────────────────────────── */}
        <Card className="overflow-hidden gap-0 py-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
            <span className="text-sm font-semibold text-foreground/90">En Büyük Kalemler</span>
            <span className="text-xs text-muted-foreground">aylık karşılık</span>
          </div>
          <CardContent className="p-5 pt-3 flex flex-col gap-0.5">
            {topDrivers.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-2">Aktif tekrarlayan kalem yok.</p>
            ) : topDrivers.map(d => {
              const income = d.type === 'income'
              return (
                <div key={d.id} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-accent transition-colors">
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-foreground/80 truncate">{d.name}</span>
                      <span className={`text-[13px] tabular-nums font-medium flex-shrink-0 ${income ? 'text-green-600' : 'text-destructive'}`}>
                        {income ? '+' : '−'}{formatCompact(d.monthlyEquivTry)}
                      </span>
                    </span>
                    <span className="block mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${maxDriver > 0 ? (d.monthlyEquivTry / maxDriver) * 100 : 0}%`,
                          background: income ? '#00C853' : '#FF1744',
                        }}
                      />
                    </span>
                  </span>
                </div>
              )
            })}
            {drivers.length > topDrivers.length && (
              <p className="text-[11px] text-muted-foreground mt-2">+{drivers.length - topDrivers.length} kalem daha</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint: string
  tone: 'ok' | 'danger' | 'neutral'
}) {
  const cls = tone === 'ok' ? 'text-green-600' : tone === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>
      </CardContent>
    </Card>
  )
}
