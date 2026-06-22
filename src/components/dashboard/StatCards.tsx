'use client'

import { useMemo } from 'react'
import { useTransactionStore, useAccountStore, useUIStore, useInvestmentStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcPeriodFlow } from '@/lib/utils/calculations'
import { formatCompact } from '@/lib/utils/currency'
import { getPeriodRange } from '@/lib/utils/date'
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

  const { from, to } = useMemo(() => getPeriodRange(periodType), [periodType])

  const { income, expense, net } = useMemo(
    () => calcPeriodFlow(transactions, from, to),
    [transactions, from, to],
  )

  const netWorth = calcNetWorth(accounts) + investValue
  const prefix   = PERIOD_LABELS[periodType]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        label={`${prefix} · Gider`}
        value={formatCompact(expense)}
        sub={expense === 0 ? 'işlem yok' : `${formatCompact(income)} gelir`}
        color="danger"
      />
      <Card
        label={`${prefix} · Gelir`}
        value={formatCompact(income)}
        sub={income === 0 ? 'işlem yok' : `${formatCompact(expense)} gider`}
        color="ok"
      />
      <Card
        label="Net Varlık"
        value={formatCompact(netWorth)}
        sub={`${accounts.length} hesap`}
        color={netWorth >= 0 ? 'ok' : 'danger'}
      />
      <Card
        label={`${prefix} · Net`}
        value={(net >= 0 ? '+' : '') + formatCompact(net)}
        sub={net > 0 ? 'fazla tasarruf' : net < 0 ? 'bütçe açığı' : 'başabaş'}
        color={net >= 0 ? 'ok' : 'danger'}
      />
    </div>
  )
}

type CardColor = 'ok' | 'danger' | 'neutral'

function Card({ label, value, sub, color }: {
  label: string
  value: string
  sub: string
  color: CardColor
}) {
  const topBorderColor =
    color === 'ok'     ? 'var(--color-ok)'     :
    color === 'danger' ? 'var(--color-danger)'  :
                         'var(--color-line-strong)'

  const valueClass =
    color === 'ok'     ? 'text-ok'    :
    color === 'danger' ? 'text-danger' :
                         'text-ink'

  return (
    <div
      className="card px-5 py-4"
      style={{ borderTopWidth: 2, borderTopColor: topBorderColor }}
    >
      <span className="text-[9px] font-semibold tracking-wider uppercase text-muted block mb-3">
        {label}
      </span>
      <div className={`text-2xl font-black tabular tracking-[-0.03em] leading-none ${valueClass}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted mt-2">{sub}</div>
    </div>
  )
}
