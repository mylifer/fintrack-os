'use client'

import type { ReactNode } from 'react'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { isPrincipalMoveTx } from '@/lib/utils/calculations'
import type { Transaction } from '@/types'

/* ── KPI Cards ─────────────────────────────────────────────────────── */
export function KpiCards({
  isLoading, filteredTxs, kpi, incomeTotal, netTotal, rateTotal, includeInvestmentIncome, fundPeriodNet,
}: {
  isLoading: boolean
  filteredTxs: Transaction[]
  kpi: { income: number; expense: number; net: number; rate: number }
  incomeTotal: number
  netTotal: number
  rateTotal: number
  includeInvestmentIncome: boolean
  fundPeriodNet: number
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
      {isLoading ? (
        [...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="px-5 py-4">
              <div className="h-2.5 w-20 bg-muted rounded animate-pulse mb-3" />
              <div className="h-7 w-32 bg-muted rounded animate-pulse" />
              <div className="h-2 w-16 bg-muted rounded animate-pulse mt-2" />
            </CardContent>
          </Card>
        ))
      ) : (
        <>
          <KPICard
            label="Toplam Gelir"
            value={<AnimatedNumber value={incomeTotal} format={formatCurrency} />}
            sub={(() => {
              // Sayı tutarla aynı kümeden: anapara hareketleri (alacak tahsilatı,
              // borç/yatırım anaparası, alanlar arası transfer) gelir değildir.
              const n = filteredTxs.filter(t => t.type === 'income' && !isPrincipalMoveTx(t)).length
              // Anahtar açık + pozitif getiri → gelire DAHİL (dashboard ile aynı).
              // Negatif dönem getirisi eklenmez; yalnız bilgi olarak gösterilir.
              if (includeInvestmentIncome && fundPeriodNet > 0.005)
                return `${n} işlem · +${formatCompact(fundPeriodNet)} fon getirisi dahil`
              if (includeInvestmentIncome && fundPeriodNet < -0.005)
                return `${n} işlem · −${formatCompact(Math.abs(fundPeriodNet))} fon değişimi (eklenmedi)`
              return `${n} işlem`
            })()}
            color="ok"
          />
          <KPICard
            label="Toplam Gider"
            value={<AnimatedNumber value={kpi.expense} format={formatCurrency} />}
            sub={`${filteredTxs.filter(t => t.type === 'expense' && !isPrincipalMoveTx(t)).length} işlem`}
            color="danger"
          />
          <KPICard
            label="Net Tasarruf"
            value={<AnimatedNumber value={Math.abs(netTotal)} format={formatCurrency} />}
            sub={netTotal >= 0 ? 'Pozitif birikim' : 'Açık var'}
            prefix={netTotal >= 0 ? '+' : '−'}
            color={netTotal >= 0 ? 'ok' : 'danger'}
          />
          <KPICard
            label="Tasarruf Oranı"
            value={`${Math.abs(rateTotal).toFixed(1)}%`}
            sub={rateTotal >= 20 ? 'Hedefin üstünde' : rateTotal > 0 ? 'Geliştirilebilir' : 'Gelir eksik'}
            prefix={rateTotal < 0 ? '−' : ''}
            color={rateTotal >= 20 ? 'ok' : rateTotal >= 0 ? 'neutral' : 'danger'}
          />
        </>
      )}
    </div>
  )
}

function KPICard({
  label, value, sub, prefix = '', color = 'neutral',
}: {
  label: string
  value: ReactNode
  sub?: string
  prefix?: string
  color?: 'ok' | 'danger' | 'neutral'
}) {
  const cls = color === 'ok' ? 'text-green-600' : color === 'danger' ? 'text-destructive' : 'text-foreground'
  return (
    <Card>
      <CardContent className="@container px-4 sm:px-5 py-4">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">{label}</div>
        <div className={`kpi-value font-normal tabular-nums ${cls}`}>
          {prefix}{value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1.5 font-medium">{sub}</div>}
      </CardContent>
    </Card>
  )
}
