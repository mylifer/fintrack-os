'use client'

import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcPeriodFlow } from '@/lib/utils/calculations'
import { formatCompact } from '@/lib/utils/currency'
import { getPeriodRange } from '@/lib/utils/date'
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
        value={formatCompact(expense)}
        sub={expense === 0 ? 'işlem yok' : `${formatCompact(income)} gelir`}
        color="danger"
      />
      <StatCard
        label={`${prefix} · Gelir`}
        value={formatCompact(income)}
        sub={income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`}
        color="ok"
      />
      <StatCard
        label="Net Varlık"
        value={formatCompact(netWorth)}
        sub={`${accounts.length} hesap`}
        color={netWorth >= 0 ? 'ok' : 'danger'}
      />
      <StatCard
        label={`${prefix} · Net`}
        value={(net >= 0 ? '+' : '') + formatCompact(net)}
        sub={net > 0 ? 'fazla tasarruf' : net < 0 ? 'bütçe açığı' : 'başabaş'}
        color={net >= 0 ? 'ok' : 'danger'}
      />
    </div>
  )
}

type CardColor = 'ok' | 'danger' | 'neutral'

function StatCard({ label, value, sub, color }: {
  label: string
  value: string
  sub: string
  color: CardColor
}) {
  const accentColor =
    color === 'ok'     ? 'var(--color-ok)'    :
    color === 'danger' ? 'var(--color-danger)' :
                         'var(--color-border)'

  const valueClass =
    color === 'ok'     ? 'text-ok'         :
    color === 'danger' ? 'text-destructive' :
                         'text-foreground'

  return (
    <Card style={{ borderTopWidth: 2, borderTopColor: accentColor }}>
      <CardContent className="flex flex-col gap-1 pt-0">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <div className={`text-xl font-medium tracking-tight tabular-nums leading-none ${valueClass}`}>
          {value}
        </div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}
