'use client'

import { useMemo, useState } from 'react'
import type { Account, CurrencyCode, PaymentSchedule } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { hasOverride } from '@/lib/utils/paymentSchedule'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  countdownLabel, PAYMENT_TYPE_LABEL,
  type ResolvedSchedule, type PaymentDisplayStatus,
} from './shared'

const PencilIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
  </svg>
)
const PauseIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
  </svg>
)
const TrashIcon = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" width={13} height={13}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
)

type Group = { key: string; title: string; color: string; items: ResolvedSchedule[] }

// Sıra: en acil önce. Her takvim ödenmemiş en eski dönemiyle TEK satırdır;
// "Daha Sonra" 7 günden uzak dönemler (bu ayın ya da — bu ay ödendiyse —
// sonraki ayların).
const GROUP_ORDER: { status: PaymentDisplayStatus; title: string; color: string }[] = [
  { status: 'overdue',  title: 'Gecikmiş',   color: 'var(--destructive)' },
  { status: 'today',    title: 'Bugün',      color: '#0d9488' },
  { status: 'upcoming', title: 'Bu Hafta',   color: '#f97316' },
  { status: 'normal',   title: 'Daha Sonra', color: 'var(--muted-foreground)' },
]

export function TimelineView({
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
  const [showInactive, setShowInactive] = useState(false)

  const groups = useMemo<Group[]>(() => {
    return GROUP_ORDER.map(g => ({
      key: g.status, title: g.title, color: g.color,
      items: resolved.filter(r => r.status === g.status).sort((a, b) => a.date.localeCompare(b.date)),
    })).filter(g => g.items.length > 0)
  }, [resolved])

  const accountName = (id?: string) => (id ? accounts.find(a => a.id === id)?.name : undefined)
  const accountCurrency = (id?: string): CurrencyCode => accounts.find(a => a.id === id)?.currency ?? 'TRY'

  if (resolved.length === 0 && inactive.length === 0) {
    return (
      <EmptyState
        icon="📅"
        title="Henüz ödeme takvimi eklenmedi"
        description="Kredi veya kredi kartı son ödeme günlerinizi ekleyin, günü gelince bildirim alın."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {groups.map(g => (
        <div key={g.key} className="mt-6 first:mt-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0" style={{ background: g.color }} />
            {g.title} — {g.items.length}
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {g.items.map((r, i) => {
              return (
                <div
                  key={r.schedule.id}
                  className={['flex items-center gap-3 px-4 py-3', i > 0 ? 'border-t border-border' : ''].join(' ')}
                >
                  <span className={[
                    'flex-shrink-0 min-w-[84px] text-center h-6 px-2 rounded-lg text-xs font-bold flex items-center justify-center',
                    r.status === 'overdue' ? 'bg-destructive/10 text-destructive'
                      : r.status === 'today' ? 'bg-teal-600/10 text-teal-700 dark:text-teal-300'
                      : r.status === 'upcoming' ? 'bg-orange-500/10 text-orange-500'
                      : 'border border-border text-muted-foreground',
                  ].join(' ')}>
                    {countdownLabel(r)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">{r.schedule.name}</span>
                      <Badge variant="outline">{PAYMENT_TYPE_LABEL[r.schedule.type]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[accountName(r.schedule.accountId), r.unpaidDueCount > 1 ? `${r.unpaidDueCount} dönem ödenmedi` : '']
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-xs font-medium">{formatDate(r.date, 'd MMM yyyy')}</span>
                      {hasOverride(r.schedule, r.monthKey) && <Badge variant="info">Bu ay özel</Badge>}
                    </div>
                    {r.schedule.amount != null && (
                      <div className="text-xs text-muted-foreground mt-0.5">{formatCurrency(r.schedule.amount, accountCurrency(r.schedule.accountId))}</div>
                    )}
                  </div>
                  <button
                    onClick={() => onMarkPaid(r.schedule.id, r.monthKey)}
                    className="text-xs font-semibold text-primary hover:underline flex-shrink-0 ml-1"
                    title="Bu dönemi ödendi olarak işaretle"
                  >
                    Ödendi
                  </button>
                  <button
                    onClick={() => onOverride(r.schedule, r.monthKey)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline flex-shrink-0"
                    title="Bu dönemin son ödeme tarihini değiştir"
                  >
                    Değiştir
                  </button>
                  <button
                    onClick={() => onToggleActive(r.schedule.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                    title="Pasife al (hatırlatma durur)"
                  >
                    <PauseIcon />
                  </button>
                  <button
                    onClick={() => onEdit(r.schedule)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                    title="Düzenle"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={() => onRemove(r.schedule.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                    title="Sil"
                  >
                    <TrashIcon />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {inactive.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowInactive(v => !v)}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className={`text-[10px] transition-transform ${showInactive ? 'rotate-90' : ''}`}>▶</span>
            Pasifler ({inactive.length})
          </button>
          {showInactive && (
            <div className="rounded-xl border border-border bg-card overflow-hidden mt-3 opacity-70">
              {inactive.map((s, i) => (
                <div key={s.id} className={['flex items-center gap-3 px-4 py-3', i > 0 ? 'border-t border-border' : ''].join(' ')}>
                  <span className="flex-shrink-0 min-w-[84px] text-center h-6 px-2 rounded-lg text-xs font-bold border border-border text-muted-foreground flex items-center justify-center">
                    Pasif
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold truncate">{s.name}</span>
                      <Badge variant="outline">{PAYMENT_TYPE_LABEL[s.type]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{accountName(s.accountId)}</div>
                  </div>
                  <button onClick={() => onToggleActive(s.id)} className="text-xs font-medium text-primary hover:underline flex-shrink-0">
                    Aktifleştir
                  </button>
                  <button
                    onClick={() => onEdit(s)}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                    title="Düzenle"
                  >
                    <PencilIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
