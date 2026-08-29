'use client'

import { useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { barGeometry, monthlyBuckets, type ForecastViewProps } from '../shared'

/**
 * Görünüm — Defter
 * "Sırayla ne oluyor?" görünümü: tek bir yoğun tablo, ufkun TAMAMI kesintisiz.
 * Kolonlar sabit hizada (Tarih · İşlem · Tutar · Bakiye · Seyir) — aynı kalemi
 * satırlar boyunca aynı x konumunda kıyaslayabilmek için. Aylar başlık bandıyla
 * ayrılır, banda o ayın gelir/gider/net'i yazılır. 'Seyir' kolonu bakiyenin
 * sıfıra göre konumunu çubukla verir; eksiye geçen satırlar kırmızı taşar.
 */
export function LedgerView({ points, events, todayStr, horizonEnd, shortfallDate }: ForecastViewProps) {
  const buckets = useMemo(
    () => monthlyBuckets(points, events, todayStr, horizonEnd),
    [points, events, todayStr, horizonEnd],
  )
  const startBalance = points[0]?.balance ?? 0

  // Çubuk ölçeği tüm ufku kapsar — aylar arasında kıyaslanabilir kalsın.
  const balances = [startBalance, ...events.map(e => e.balanceAfter)]
  const min = Math.min(...balances)
  const max = Math.max(...balances)

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-[10px] text-muted-foreground border-b border-border/60">
              <th className="py-2 pl-5 pr-3 text-left font-semibold uppercase tracking-wide w-28">Tarih</th>
              <th className="py-2 pr-3 text-left font-semibold uppercase tracking-wide">İşlem</th>
              <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wide w-32">Tutar</th>
              <th className="py-2 pr-5 text-right font-semibold uppercase tracking-wide w-36">Bakiye</th>
              <th className="py-2 pr-5 text-left font-semibold uppercase tracking-wide w-40 hidden lg:table-cell">Seyir</th>
            </tr>
          </thead>
          <tbody>
            {/* Açılış satırı — yürüyüşün başladığı bugünkü bakiye */}
            <tr className="border-b border-border/40 text-muted-foreground">
              <td className="py-2 pl-5 pr-3 text-[12px] tabular-nums whitespace-nowrap">{formatDate(todayStr, 'd MMM')}</td>
              <td className="py-2 pr-3 text-[13px]">Bugünkü bakiye</td>
              <td className="py-2 pr-3 text-right text-[13px] tabular-nums">—</td>
              <td className={`py-2 pr-5 text-right text-[13px] tabular-nums font-medium ${startBalance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(startBalance)}
              </td>
              <td className="py-2 pr-5 hidden lg:table-cell">
                <Bar value={startBalance} min={min} max={max} />
              </td>
            </tr>

            {buckets.map(b => (
              <FragmentMonth key={b.key} label={b.label} income={b.income} expense={b.expense} net={b.net} endBalance={b.endBalance}>
                {b.events.map((e, i) => {
                  const income = e.type === 'income'
                  const isShortfall = shortfallDate != null && e.date === shortfallDate
                  return (
                    <tr
                      key={`${b.key}-${i}`}
                      className={`border-b border-border/40 hover:bg-accent/60 transition-colors ${isShortfall ? 'bg-destructive/10' : ''}`}
                    >
                      <td className="py-1.5 pl-5 pr-3 text-[12px] tabular-nums text-muted-foreground whitespace-nowrap">
                        {formatDate(e.date, 'd MMM')}
                        <span className="ml-1.5 text-[10px] opacity-70">{formatDate(e.date, 'EEE')}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-[13px] text-foreground/85 truncate max-w-0">{e.name}</td>
                      <td className={`py-1.5 pr-3 text-right text-[13px] tabular-nums font-medium ${income ? 'text-green-600' : 'text-destructive'}`}>
                        {income ? '+' : '−'}{formatCurrency(e.amountTry)}
                      </td>
                      <td className={`py-1.5 pr-5 text-right text-[13px] tabular-nums ${e.balanceAfter < 0 ? 'text-destructive font-semibold' : 'text-foreground/80'}`}>
                        {formatCurrency(e.balanceAfter)}
                      </td>
                      <td className="py-1.5 pr-5 hidden lg:table-cell">
                        <Bar value={e.balanceAfter} min={min} max={max} />
                      </td>
                    </tr>
                  )
                })}
              </FragmentMonth>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border/50">
        {events.length} işlem · bakiye kolonu, o işlemden sonraki tahmini bakiyeyi gösterir.
      </p>
    </Card>
  )
}

/** Ay bandı + o ayın satırları. */
function FragmentMonth({
  label, income, expense, net, endBalance, children,
}: {
  label: string
  income: number
  expense: number
  net: number
  endBalance: number
  children: React.ReactNode
}) {
  return (
    <>
      <tr className="bg-secondary/50">
        <td colSpan={2} className="py-1.5 pl-5 pr-3 text-[11px] font-semibold tracking-wide uppercase text-foreground/70">
          {label}
        </td>
        <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums whitespace-nowrap">
          <span className="text-green-600">+{formatCompact(income)}</span>
          <span className="text-muted-foreground/50 mx-1">/</span>
          <span className="text-destructive">−{formatCompact(expense)}</span>
        </td>
        <td className={`py-1.5 pr-5 text-right text-[11px] tabular-nums font-semibold ${endBalance < 0 ? 'text-destructive' : 'text-foreground/70'}`}>
          {formatCompact(endBalance)}
        </td>
        <td className="py-1.5 pr-5 text-[11px] tabular-nums hidden lg:table-cell">
          <span className={net >= 0 ? 'text-green-600' : 'text-destructive'}>
            net {net >= 0 ? '+' : '−'}{formatCompact(Math.abs(net))}
          </span>
        </td>
      </tr>
      {children}
    </>
  )
}

/** Bakiyenin sıfıra göre konumu — sıfır sabit bir x'te durur. */
function Bar({ value, min, max }: { value: number; min: number; max: number }) {
  const { zeroPct, leftPct, widthPct, negative } = barGeometry(value, min, max)
  return (
    <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${leftPct}%`,
          width: `${Math.max(widthPct, 0.5)}%`,
          background: negative ? 'var(--destructive)' : 'var(--primary)',
        }}
      />
      {min < 0 && (
        <div className="absolute inset-y-0 w-px bg-foreground/25" style={{ left: `${zeroPct}%` }} />
      )}
    </div>
  )
}
