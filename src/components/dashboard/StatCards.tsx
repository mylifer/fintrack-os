'use client'

import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcPeriodFlow } from '@/lib/utils/calculations'
import { formatCompact } from '@/lib/utils/currency'
import { getPeriodRange } from '@/lib/utils/date'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { Card, CardContent } from '@/components/ui/card'
import type { PeriodType } from '@/types'

const PERIOD_LABELS: Record<PeriodType, string> = {
  daily:   'Bugün',
  weekly:  'Bu Hafta',
  monthly: 'Bu Ay',
  yearly:  'Bu Yıl',
  all:     'Tüm Zamanlar',
}

export function StatCards() {
  const transactions  = useTransactionStore(s => s.transactions)
  const accounts      = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const periodType    = useUIStore(s => s.periodType)
  const investValue   = useInvestmentStore(s => s.getPortfolioValue())
  const prices        = useInvestmentStore(s => s.prices)

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  const { income, expense, net } = useMemo(
    () => calcPeriodFlow(transactions, from, to),
    [transactions, from, to],
  )

  const netWorth = calcNetWorth(accounts, prices) + investValue
  const prefix   = PERIOD_LABELS[periodType]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
      <StatCard
        label={`${prefix} · Gider`}
        value={expense}
        sub={expense === 0 ? 'işlem yok' : `${formatCompact(income)} gelir`}
        color="danger"
      />
      <StatCard
        label={`${prefix} · Gelir`}
        value={income}
        sub={income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`}
        color="ok"
      />
      <StatCard
        label="Net Varlık"
        value={netWorth}
        sub={`${accounts.length} hesap`}
        color={netWorth >= 0 ? 'ok' : 'danger'}
      />
      <StatCard
        label={`${prefix} · Net`}
        value={net}
        sub={net > 0 ? 'fazla tasarruf' : net < 0 ? 'bütçe açığı' : 'başabaş'}
        color={net >= 0 ? 'ok' : 'danger'}
        showSign
      />
    </div>
  )
}

type CardColor = 'ok' | 'danger' | 'neutral'

function StatCard({ label, value, sub, color, showSign = false }: {
  label: string
  value: number
  sub: string
  color: CardColor
  showSign?: boolean
}) {
  const animated  = useCountUp(Math.abs(value))
  const sign      = value < 0 ? '−' : showSign ? '+' : ''
  const formatted = sign + formatCompact(animated)
  const valueClass =
    color === 'ok'     ? 'text-green-600'    :
    color === 'danger' ? 'text-destructive'  :
                         'text-foreground'

  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{formatted}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  )
}
