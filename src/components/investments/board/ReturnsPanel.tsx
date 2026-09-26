'use client'

import { useMemo } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { investmentXirr, realizedSales, XIRR_MIN_DAYS } from '@/lib/utils/investment-returns'
import { assetMeta, fmtPct, pnlColor, type AssetRow } from './shared'
import type { InvestmentAsset, InvestmentTransaction, TefasFundPrice } from '@/types'

/* ── Getiri paneli ────────────────────────────────────────────────────────────
 * Tahtanın özet şeridi yalnız ELDEKİ varlıkların gerçekleşmemiş K/Z'sini
 * gösterir; satılmış varlıkların kârı orada görünmez. Bu panel iki eksiği
 * kapatır:
 *   • Gerçekleşen K/Z — satışlardan (ortalama maliyetle, satış anındaki
 *     maliyet; bkz. investment-returns.ts). Brüt: TEFAS stopajı ayrı gider
 *     satırı olarak deftere yazılır.
 *   • Yıllık getiri (XIRR) — alım/satış tarihleri ve bugünkü değerden; "3 ayda
 *     %10" ile "3 yılda %10"u ayırt eder. 30 günden kısa sürede gösterilmez.
 * ------------------------------------------------------------------------- */

interface Line {
  asset:      InvestmentAsset
  label:      string
  subLabel?:  string
  realized:   number
  unrealized: number | null
  xirr:       number | null
  held:       boolean
}

const fmtSigned = (v: number) => (v >= 0 ? '+' : '−') + formatCurrency(Math.abs(v))
const fmtRate   = (r: number | null) => (r === null ? '—' : fmtPct(r * 100))

export function ReturnsPanel({ rows, transactions, fundPrices }: {
  rows:         AssetRow[]
  transactions: InvestmentTransaction[]
  fundPrices:   Record<string, TefasFundPrice>
}) {
  const todayStr = today()

  const { lines, realizedTotal, realizedYear, unrealizedTotal, portfolioXirr } = useMemo(() => {
    const sales   = realizedSales(transactions)
    const rowOf   = new Map(rows.map(r => [r.asset, r]))
    const assets  = [...new Set(transactions.map(t => t.asset))]
    const year    = todayStr.slice(0, 4)

    const lines: Line[] = assets.map(asset => {
      const row  = rowOf.get(asset)
      const meta = assetMeta(asset, fundPrices)
      const held = !!row && row.quantity > 0.000001
      const priced = !held || row.hasPrices
      return {
        asset,
        label:      meta.label,
        subLabel:   meta.subLabel,
        realized:   sales.filter(s => s.asset === asset).reduce((s, x) => s + x.gain, 0),
        unrealized: held ? (row.hasPrices ? row.pnl : null) : 0,
        xirr:       priced ? investmentXirr(transactions.filter(t => t.asset === asset), held ? row.currentValue : 0, todayStr) : null,
        held,
      }
    }).sort((a, b) => (b.realized + (b.unrealized ?? 0)) - (a.realized + (a.unrealized ?? 0)))

    const allPriced = rows.every(r => r.quantity <= 0.000001 || r.hasPrices)
    const value     = rows.reduce((s, r) => s + r.currentValue, 0)

    return {
      lines,
      realizedTotal:   sales.reduce((s, x) => s + x.gain, 0),
      realizedYear:    sales.filter(s => s.date.startsWith(year)).reduce((s, x) => s + x.gain, 0),
      unrealizedTotal: rows.filter(r => r.hasPrices).reduce((s, r) => s + r.pnl, 0),
      portfolioXirr:   allPriced ? investmentXirr(transactions, value, todayStr) : null,
    }
  }, [rows, transactions, fundPrices, todayStr])

  if (!transactions.length) return null
  const hasSales = transactions.some(t => t.type === 'sell')

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-5 h-11 flex items-center border-b border-border/60">
        <span className="text-sm font-semibold text-foreground/90">Getiri</span>
        <span className="ml-auto text-[11px] text-muted-foreground hidden sm:block">
          Gerçekleşen K/Z brüt (stopaj hariç) · yıllık getiri = XIRR
        </span>
      </div>

      <div className="px-5 py-3.5 flex flex-wrap gap-x-8 gap-y-3 border-b border-border/60">
        <Stat label="Gerçekleşen K/Z" value={hasSales ? fmtSigned(realizedTotal) : '—'} tone={hasSales ? pnlColor(realizedTotal) : undefined}
          note={hasSales ? undefined : 'Henüz satış yok'} />
        <Stat label={`${todayStr.slice(0, 4)} gerçekleşen`} value={hasSales ? fmtSigned(realizedYear) : '—'} tone={hasSales ? pnlColor(realizedYear) : undefined} />
        <Stat label="Gerçekleşmemiş K/Z" value={fmtSigned(unrealizedTotal)} tone={pnlColor(unrealizedTotal)} />
        <Stat label="Toplam K/Z" value={fmtSigned(realizedTotal + unrealizedTotal)} tone={pnlColor(realizedTotal + unrealizedTotal)} />
        <Stat
          label="Yıllık getiri (XIRR)"
          value={fmtRate(portfolioXirr)}
          tone={portfolioXirr === null ? 'text-muted-foreground' : pnlColor(portfolioXirr)}
          note={portfolioXirr === null ? `${XIRR_MIN_DAYS} günden kısa geçmiş ya da eksik fiyat` : undefined}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2 text-left font-medium">Varlık</th>
              <th className="px-3 py-2 text-right font-medium">Gerçekleşen</th>
              <th className="px-3 py-2 text-right font-medium">Gerçekleşmemiş</th>
              <th className="px-3 py-2 text-right font-medium">Toplam</th>
              <th className="px-5 py-2 text-right font-medium">Yıllık (XIRR)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const total = l.realized + (l.unrealized ?? 0)
              return (
                <tr key={l.asset} className="border-t border-border/40">
                  <td className="px-5 py-2.5">
                    <span className="font-medium text-foreground">{l.label}</span>
                    {l.subLabel && <span className="ml-2 text-[11px] text-muted-foreground">{l.subLabel}</span>}
                    {!l.held && <span className="ml-2 text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">satıldı</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${l.realized ? pnlColor(l.realized) : 'text-muted-foreground'}`}>
                    {l.realized ? fmtSigned(l.realized) : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${l.unrealized ? pnlColor(l.unrealized) : 'text-muted-foreground'}`}>
                    {l.unrealized === null ? 'fiyat yok' : l.held ? fmtSigned(l.unrealized) : '—'}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${pnlColor(total)}`}>{fmtSigned(total)}</td>
                  <td className={`px-5 py-2.5 text-right tabular-nums ${l.xirr === null ? 'text-muted-foreground' : pnlColor(l.xirr)}`}>
                    {fmtRate(l.xirr)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div title={note}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground block">{label}</span>
      <span className={`tabular-nums text-sm font-medium ${tone || 'text-foreground'}`}>{value}</span>
      {note && <span className="block text-[9px] text-muted-foreground">{note}</span>}
    </div>
  )
}
