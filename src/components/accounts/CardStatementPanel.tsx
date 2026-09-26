'use client'

import { Fragment, useMemo, useState } from 'react'
import { useAccountStore, usePaymentsStore, useTransactionStore } from '@/store'
import { buildCardStatements, type StatementStatus } from '@/lib/utils/card-statement'
import { assignCardPayments } from '@/lib/payments/schedule'
import { planIdFor } from '@/lib/payments/ids'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { Badge } from '@/components/ui/Badge'
import type { Account } from '@/types'

const STATUS: Record<StatementStatus, { label: string; variant: 'ok' | 'danger' | 'amber' | 'secondary' }> = {
  clear:   { label: 'Borç yok', variant: 'secondary' },
  paid:    { label: 'Ödendi',   variant: 'ok' },
  partial: { label: 'Kısmi',    variant: 'amber' },
  open:    { label: 'Bekliyor', variant: 'secondary' },
  overdue: { label: 'Gecikti',  variant: 'danger' },
}

const fmtDay = (iso: string) => formatDate(iso, 'd MMM')

/** Kredi kartı hesabının ekstreleri (lib/utils/card-statement). Uygulamaya
 *  girilen işlemlerden hesaplanır — bankanın ekstresiyle farkı eksik girilmiş
 *  işlemdir. */
export function CardStatementPanel({ account }: { account: Account }) {
  const transactions = useTransactionStore(s => s.transactions)
  const accounts     = useAccountStore(s => s.accounts)
  const plan = usePaymentsStore(s => s.plans.find(p => p.id === planIdFor('card', account.id)))
  const [expanded, setExpanded] = useState<string | null>(null)

  const todayStr = today()
  const result = useMemo(() => buildCardStatements(account, transactions, {
    payments: assignCardPayments(accounts, transactions).get(account.id) ?? [],
    dueDay: plan?.dayOfMonth ?? null,
    minPayPct: account.minPayPct && account.minPayPct !== 3 ? account.minPayPct : null,
    todayStr,
  }), [account, accounts, transactions, plan?.dayOfMonth, todayStr])

  const money = (n: number) => formatCurrency(n, account.currency)
  const last = result.statements[0]

  return (
    <div className="px-6 lg:px-8 py-4 border-b border-border bg-card flex-shrink-0">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ekstre</div>
        <div className="text-xs text-muted-foreground">
          Kesim her ayın {account.statementDay ?? 1}&apos;i
          {plan?.dayOfMonth ? ` · son ödeme ${plan.dayOfMonth}'i` : ''}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <div className="text-xs text-muted-foreground">
            Dönem içi · {fmtDay(result.open.period.from)} – {fmtDay(result.open.period.to)}
          </div>
          <div className="text-lg font-medium tabular-nums mt-0.5">{money(result.open.total)}</div>
          <div className="text-xs text-muted-foreground">{fmtDay(result.open.period.to)} tarihinde kesilecek</div>
        </div>
        {last && (
          <div className="rounded-xl border border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Son ekstre · {fmtDay(last.period.from)} – {fmtDay(last.period.to)}
              </div>
              <Badge variant={STATUS[last.status].variant}>{STATUS[last.status].label}</Badge>
            </div>
            <div className="text-lg font-medium tabular-nums mt-0.5">{money(last.total)}</div>
            <div className="text-xs text-muted-foreground">
              {[
                last.dueDate ? `Son ödeme ${formatDate(last.dueDate, 'd MMM')}` : 'Son ödeme günü girilmemiş',
                last.minPayment !== null ? `asgari ${money(last.minPayment)}` : null,
                last.paid > 0 ? `ödenen ${money(last.paid)}` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}
      </div>

      {!plan?.dayOfMonth && (
        <p className="text-xs text-muted-foreground mb-3">
          Son ödeme günü ve asgari ödeme oranını &quot;Düzenle&quot;den girerseniz gecikme durumu ve asgari tutar da gösterilir.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-3 text-left font-medium">Dönem</th>
              <th className="py-1.5 pr-3 text-right font-medium">Borç</th>
              <th className="py-1.5 pr-3 text-right font-medium">Asgari</th>
              <th className="py-1.5 pr-3 text-left font-medium">Son ödeme</th>
              <th className="py-1.5 pr-3 text-right font-medium">Ödenen</th>
              <th className="py-1.5 text-left font-medium">Durum</th>
            </tr>
          </thead>
          <tbody>
            {result.statements.map(s => {
              const key = s.period.to
              const isOpen = expanded === key
              return (
                <Fragment key={key}>
                  <tr
                    className="border-b border-border/50 cursor-pointer hover:bg-accent/40"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    aria-expanded={isOpen}
                  >
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      <span className="text-muted-foreground mr-1">{isOpen ? '▾' : '▸'}</span>
                      {fmtDay(s.period.from)} – {formatDate(s.period.to, 'd MMM yy')}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{money(s.total)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                      {s.minPayment !== null && s.total > 0 ? money(s.minPayment) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                      {s.dueDate ? fmtDay(s.dueDate) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{s.paid > 0 ? money(s.paid) : '—'}</td>
                    <td className="py-1.5"><Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/50 bg-muted/30">
                      <td colSpan={6} className="px-3 py-2">
                        {s.charges.length === 0 ? (
                          <span className="text-muted-foreground">Bu dönemde işlem yok.</span>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {s.charges.map(t => (
                              <li key={t.id} className="flex items-center justify-between gap-3">
                                <span className="truncate">
                                  <span className="text-muted-foreground mr-2 tabular-nums">{fmtDay(t.date)}</span>
                                  {t.description}
                                  {t.isInstallment && t.installTotal ? (
                                    <span className="text-muted-foreground ml-1">({t.installIndex}/{t.installTotal})</span>
                                  ) : null}
                                </span>
                                <span className={`tabular-nums flex-shrink-0 ${t.type === 'income' ? 'text-green-600' : ''}`}>
                                  {t.type === 'income' ? '−' : ''}{formatCurrency(t.amount, t.currency)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
