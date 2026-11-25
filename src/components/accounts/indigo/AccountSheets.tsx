'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import type { StatementStatus } from '@/lib/utils/card-statement'
import { useCardStatements } from '../useCardStatements'
import { IndigoSheet, KeyValueList, SheetButtons, sheetBtnPrimary, sheetBtnSecondary } from './IndigoSheet'
import { PlanRow, type InstallmentPlan } from './AccountSideCards'
import type { Account, Transaction } from '@/types'

const BADGE: Record<StatementStatus, { label: string; cls: string }> = {
  clear:   { label: 'Borç yok',  cls: 'bg-[var(--ip-chip)] text-[var(--ip-sub)]' },
  paid:    { label: 'Ödendi',    cls: 'bg-[var(--ip-pos)]/15 text-[var(--ip-pos)]' },
  partial: { label: 'Kısmi',     cls: 'bg-orange-500/15 text-orange-600' },
  open:    { label: 'Bekliyor',  cls: 'bg-[var(--ip-accent)]/15 text-[var(--ip-accent)]' },
  overdue: { label: 'Gecikti',   cls: 'bg-[var(--ip-neg)]/15 text-[var(--ip-neg)]' },
}

/** Ekstreler — açık dönem + geçmiş ekstreler; birine dokununca o dönemin
 *  harcamaları açılır. Hesap Kart Takvimi'yle aynı kaynaktan (useCardStatements). */
export function StatementsSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const { result, resolved, plan } = useCardStatements(account)
  const [open, setOpen] = useState<string | null>(null)
  const money = (n: number) => formatCurrency(n, account.currency)
  const rows = [
    { key: 'open', title: 'Bu dönem', from: result.open.period.from, to: result.open.period.to, total: result.open.total,
      due: null as string | null, badge: { label: 'Birikiyor', cls: BADGE.open.cls }, charges: result.open.charges, min: null as number | null, paid: 0 },
    ...result.statements.map(s => ({
      key: s.period.to, title: `${formatDate(s.period.to, 'MMMM')} ekstresi`, from: s.period.from, to: s.period.to, total: s.total,
      due: s.dueDate, badge: BADGE[s.status], charges: s.charges, min: s.minPayment, paid: s.paid,
    })),
  ]

  return (
    <IndigoSheet title="Ekstreler" onClose={onClose}>
      <p className="text-sm text-[var(--ip-sub)]">
        Kesim her ayın {account.statementDay ?? 1}&apos;i
        {resolved.days.gapDays ? ` · son ödeme kesimden ${resolved.days.gapDays} gün sonra` : plan?.dayOfMonth ? ` · son ödeme ${plan.dayOfMonth}'i` : ''}
        {' · '}<Link href="/kart-takvimi" className="font-bold text-[var(--ip-accent)] hover:underline">Kart Takvimi</Link>
      </p>
      <div className="mt-3">
        {rows.map(r => {
          const isOpen = open === r.key
          return (
            <div key={r.key} className="border-t border-[var(--ip-line)] first:border-t-0">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)}
                className="flex w-full items-center gap-3 py-3.5 text-left">
                <span className="flex size-[46px] flex-none items-center justify-center rounded-[14px] bg-[var(--ip-surface2)]" aria-hidden="true">
                  <ReceiptText className="size-[22px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="first-letter:uppercase">{r.title}</b>
                  <span className="text-[13px] text-[var(--ip-sub)]">
                    {formatDate(r.from, 'd MMM')} – {formatDate(r.to, 'd MMM')}{r.due ? ` · son ödeme ${formatDate(r.due, 'd MMM')}` : ''}
                  </span>
                </span>
                <span className="flex flex-none flex-col items-end gap-1">
                  <b className="tabular-nums">{money(r.total)}</b>
                  <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold ${r.badge.cls}`}>{r.badge.label}</span>
                </span>
              </button>
              {isOpen && (
                <div className="mb-3 rounded-[18px] bg-[var(--ip-surface2)] px-4 py-2 text-sm">
                  {(r.min !== null || r.paid > 0) && (
                    <p className="border-b border-[var(--ip-line)] py-2 text-[var(--ip-sub)]">
                      {[r.min !== null ? `Asgari ${money(r.min)}` : null, r.paid > 0 ? `Ödenen ${money(r.paid)}` : null].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {r.charges.length === 0 ? <p className="py-2 text-[var(--ip-sub)]">Bu dönemde işlem yok.</p> : r.charges.map(t => (
                    <div key={t.id} className="flex justify-between gap-3 py-1.5">
                      <span className="truncate"><span className="mr-2 text-[var(--ip-sub)] tabular-nums">{formatDate(t.date.slice(0, 10), 'd MMM')}</span>{t.description}</span>
                      <span className={`flex-none tabular-nums ${t.type === 'income' ? 'text-[var(--ip-pos)]' : ''}`}>{t.type === 'income' ? '−' : ''}{formatCurrency(t.amount, t.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <SheetButtons><button type="button" className={sheetBtnSecondary} onClick={onClose}>Kapat</button></SheetButtons>
    </IndigoSheet>
  )
}

export function PlansSheet({ account, plans, onClose, onOpenTx }: {
  account: Account; plans: InstallmentPlan[]; onClose: () => void; onOpenTx: (t: Transaction) => void
}) {
  const left = plans.reduce((s, p) => s + p.left, 0)
  return (
    <IndigoSheet title="Taksitler" onClose={onClose}>
      <p className="mb-2 text-sm text-[var(--ip-sub)]">{plans.length} plan · kalan {formatCurrency(left, account.currency)}</p>
      {plans.map(p => <PlanRow key={p.first.installGroupId} plan={p} currency={account.currency} onOpen={onOpenTx} />)}
      <SheetButtons><button type="button" className={sheetBtnSecondary} onClick={onClose}>Kapat</button></SheetButtons>
    </IndigoSheet>
  )
}

const TYPE_LABELS: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi kartı', investment: 'Yatırım', loan: 'Kredi',
}

export function AccountInfoSheet({ account, available, onClose, onEdit, onReconcile }: {
  account: Account; available: number | null; onClose: () => void; onEdit: () => void; onReconcile: () => void
}) {
  const isCard = account.type === 'credit_card'
  const rows: [string, React.ReactNode][] = [
    [isCard ? 'Kart' : 'Hesap', account.name],
    ['Tür', TYPE_LABELS[account.type] ?? account.type],
    ['Para birimi', account.currency],
    [isCard ? 'Güncel borç' : 'Bakiye', `${account.balance < 0 ? '−' : ''}${formatCurrency(Math.abs(account.balance), account.currency)}`],
  ]
  if (isCard && account.creditLimit) rows.push(['Limit', formatCurrency(account.creditLimit, account.currency)])
  if (isCard && available !== null) rows.push(['Kullanılabilir', formatCurrency(available, account.currency)])
  if (isCard) rows.push(['Kesim günü', `Her ayın ${account.statementDay ?? 1}'i`])
  if (account.createdAt) rows.push(['Eklendiği gün', formatDate(account.createdAt.slice(0, 10) || today(), 'd MMMM yyyy')])

  return (
    <IndigoSheet title={isCard ? 'Kart bilgileri' : 'Hesap bilgileri'} onClose={onClose}>
      <KeyValueList rows={rows} />
      <SheetButtons>
        <button type="button" className={sheetBtnSecondary} onClick={() => { onClose(); onReconcile() }}>Bakiyeyi eşitle</button>
        <button type="button" className={sheetBtnPrimary} onClick={() => { onClose(); onEdit() }}>Düzenle</button>
      </SheetButtons>
    </IndigoSheet>
  )
}
