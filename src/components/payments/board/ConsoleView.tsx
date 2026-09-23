'use client'

import { useMemo, useState } from 'react'
import type { Account, CurrencyCode, PaymentSchedule } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { dueDateForMonth, hasOverride, monthKeyOf } from '@/lib/utils/paymentSchedule'
import { STATUS_BADGE, PAYMENT_TYPE_LABEL, type ResolvedSchedule } from './shared'

const PencilIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const TrashIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)
const CheckIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
)
const PauseIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
  </svg>
)
const PlayIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
  </svg>
)
const CalendarIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0V11.25a2.25 2.25 0 0 1 2.25-2.25h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5" />
  </svg>
)

type FilterKey = 'all' | 'overdue' | 'upcoming' | 'inactive'
type SortKey = 'name' | 'date' | 'amount'

const TABS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'Tümü' },
  { key: 'overdue',  label: 'Gecikmiş' },
  { key: 'upcoming', label: 'Yaklaşan' },
  { key: 'inactive', label: 'Pasif' },
]

interface Row {
  schedule: PaymentSchedule
  date: string
  monthKey: string
  amount: number
  filterKey: FilterKey
  badge?: { label: string; variant: 'danger' | 'today' | 'warning' | 'outline' }
}

export function ConsoleView({
  resolved, inactive, accounts, onEdit, onRemove, onToggleActive, onOverride, onMarkPaid,
}: {
  resolved: ResolvedSchedule[]
  inactive: PaymentSchedule[]
  accounts: Account[]
  onEdit: (s: PaymentSchedule) => void
  onRemove: (id: string) => void
  onToggleActive: (id: string) => void
  onOverride: (s: PaymentSchedule, monthKey: string) => void
  onMarkPaid: (id: string, monthKey: string) => void
}) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  const todayStr = today()
  const accountName = (id?: string) => (id ? accounts.find(a => a.id === id)?.name : undefined)
  const accountCurrency = (id?: string): CurrencyCode => accounts.find(a => a.id === id)?.currency ?? 'TRY'

  const allRows = useMemo<Row[]>(() => {
    const active: Row[] = resolved.map(r => ({
      schedule: r.schedule,
      date: r.date,
      monthKey: r.monthKey,
      amount: r.schedule.amount ?? 0,
      filterKey: r.status === 'overdue' ? 'overdue' : r.status === 'today' || r.status === 'upcoming' ? 'upcoming' : 'all',
      badge: r.status === 'normal' ? undefined : {
        ...STATUS_BADGE[r.status],
        label: r.unpaidDueCount > 1 ? `${STATUS_BADGE[r.status].label} ×${r.unpaidDueCount}` : STATUS_BADGE[r.status].label,
      },
    }))
    const passive: Row[] = inactive.map(s => {
      const monthKey = monthKeyOf(todayStr)
      return {
        schedule: s, date: dueDateForMonth(s, monthKey), monthKey, amount: s.amount ?? 0,
        filterKey: 'inactive', badge: { label: 'Pasif', variant: 'outline' },
      }
    })
    return [...active, ...passive]
  }, [resolved, inactive, todayStr])

  const rows = useMemo(() => {
    let out = filter === 'all' ? allRows : allRows.filter(r => r.filterKey === filter)
    if (sortKey) {
      out = [...out].sort((a, b) => {
        // Ad: Türkçe harf sırası (Ç/Ş/İ/Ö/Ü, Z'nin sonuna düşmesin)
        if (sortKey === 'name') return a.schedule.name.localeCompare(b.schedule.name, 'tr') * sortDir
        const av = sortKey === 'amount' ? a.amount : a.date
        const bv = sortKey === 'amount' ? b.amount : b.date
        return av < bv ? -sortDir : av > bv ? sortDir : 0
      })
    }
    return out
  }, [allRows, filter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(key); setSortDir(1) }
  }
  function arrow(key: SortKey) {
    if (sortKey !== key) return null
    return <span className="text-[9px] ml-1 opacity-70">{sortDir === 1 ? '▲' : '▼'}</span>
  }

  if (allRows.length === 0) {
    return (
      <EmptyState
        icon="📅"
        title="Henüz ödeme takvimi eklenmedi"
        description="Kredi veya kredi kartı son ödeme günlerinizi ekleyin, günü gelince bildirim alın."
      />
    )
  }

  const th = 'text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5 select-none'
  const thSortable = `${th} cursor-pointer hover:text-foreground`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={[
                'text-xs font-semibold pb-1 border-b-2 transition-colors',
                filter === t.key ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent hover:text-foreground',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} kayıt</span>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border">
              <th className={thSortable} onClick={() => toggleSort('name')}>Ad{arrow('name')}</th>
              <th className={th}>Tür</th>
              <th className={th}>Hesap</th>
              <th className={thSortable} onClick={() => toggleSort('date')}>Vade{arrow('date')}</th>
              <th className={`${thSortable} text-right`} onClick={() => toggleSort('amount')}>Tutar{arrow('amount')}</th>
              <th className={th}>Durum</th>
              <th className={`${th} text-right`}>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.schedule.id}
                className={[
                  i > 0 ? 'border-t border-border' : '',
                  'hover:bg-accent/50 transition-colors',
                  r.filterKey === 'inactive' ? 'opacity-60' : '',
                ].join(' ')}
              >
                <td className="px-3 py-2.5 font-medium">{r.schedule.name}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{PAYMENT_TYPE_LABEL[r.schedule.type]}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{accountName(r.schedule.accountId) ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {formatDate(r.date, 'd MMM yyyy')}
                    {hasOverride(r.schedule, r.monthKey) && <Badge variant="info">Özel</Badge>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                  {r.schedule.amount != null ? formatCurrency(r.schedule.amount, accountCurrency(r.schedule.accountId)) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  {r.badge ? <Badge variant={r.badge.variant}>{r.badge.label}</Badge> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-0.5">
                    {r.filterKey !== 'inactive' && (
                      <>
                        <button
                          onClick={() => onMarkPaid(r.schedule.id, r.monthKey)}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Bu dönemi ödendi olarak işaretle"
                        >
                          <CheckIcon />
                        </button>
                        <button
                          onClick={() => onOverride(r.schedule, r.monthKey)}
                          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          title="Bu dönemin tarihini değiştir"
                        >
                          <CalendarIcon />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onToggleActive(r.schedule.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title={r.filterKey === 'inactive' ? 'Aktifleştir' : 'Pasife al (hatırlatma durur)'}
                    >
                      {r.filterKey === 'inactive' ? <PlayIcon /> : <PauseIcon />}
                    </button>
                    <button
                      onClick={() => onEdit(r.schedule)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Düzenle"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => onRemove(r.schedule.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Sil"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
