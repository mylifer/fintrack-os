'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useShallow } from 'zustand/react/shallow'
import { useAccountStore, useCategoryStore, useTransactionStore } from '@/store'
import type { AppNotification } from '@/store/notifications.store'
import { approveRecurring, skipRecurring } from '@/lib/utils/recurring-actions'
import { formatCurrency } from '@/lib/utils/currency'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import type { CurrencyCode, RecurringFrequency, Transaction, TransactionType } from '@/types'

/* Zile tıklayınca açılan bildirim paneli. İki bölüm:
     1. "Onay bekleyen" — tarihi gelmiş öğeler (aksiyonlu):
        • tekrarlayan: Onayla (paylaşılan approveRecurring — catch-up +
          deterministik id'ler) / Atla (skip),
        • gelecek işlem: Onayla (approvalStatus → 'approved') / Reddet
          (mevcut remove akışı — soft delete + Undo toast, kalıcı silme değil).
     2. "Yaklaşan" — 7 gün içindeki pending işlemler (erken onay opsiyonel) +
        nextDueDate'i yaklaşan tekrarlayanlar (salt bilgi).
   Onay/atlama sonrası liste reaktif düşer: her iki bölüm de store'lardan
   türetilir (useNotifications), ekstra senkron gerekmez. */

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık',
}

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: 'Gider', income: 'Gelir', transfer: 'Transfer',
}

function fmtDay(iso: string): string {
  return format(new Date(iso.slice(0, 10) + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })
}

function AmountText({ type, amount, currency }: { type: TransactionType; amount: number; currency: CurrencyCode }) {
  return (
    <span className={[
      'font-semibold tabular-nums text-sm flex-shrink-0',
      type === 'income' ? 'text-green-600' : type === 'transfer' ? 'text-blue-500' : 'text-destructive',
    ].join(' ')}>
      {type === 'income' ? '+' : type === 'expense' ? '−' : '⇄'}
      {formatCurrency(Math.abs(amount), currency)}
    </span>
  )
}

function RowShell({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-3 px-4 py-3">{children}</div>
}

function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 mt-2">{children}</div>
}

const actionBtn = 'text-xs font-semibold px-2.5 h-7 rounded-lg transition-colors disabled:opacity-50'
const primaryBtn = `${actionBtn} bg-primary text-primary-foreground hover:bg-primary/90`
const ghostBtn   = `${actionBtn} border border-border text-muted-foreground hover:text-foreground hover:bg-accent`
const dangerBtn  = `${actionBtn} border border-border text-muted-foreground hover:text-destructive hover:bg-destructive/5`

export function NotificationPanel({
  notifications, onClose,
}: {
  notifications: AppNotification[]
  onClose: () => void
}) {
  const accounts   = useAccountStore(useShallow(s => s.accounts))
  const categories = useCategoryStore(s => s.categories)
  const updateTx   = useTransactionStore(s => s.update)
  const removeTx   = useTransactionStore(s => s.remove)

  // Aynı öğede çift tık / eşzamanlı aksiyon koruması
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const due = notifications.filter(n => n.kind === 'recurring-due' || n.kind === 'future-tx-due')
  const upcoming = notifications.filter(n => n.kind === 'recurring-upcoming' || n.kind === 'future-tx-upcoming')

  const accountName  = (id: string) => accounts.find(a => a.id === id)?.name
  const categoryOf   = (id?: string) => (id ? categories.find(c => c.id === id) : undefined)

  async function run(key: string, fn: () => Promise<void>) {
    if (busyKey) return
    setBusyKey(key)
    try {
      await fn()
    } catch (err) {
      console.error('[notifications:action]', err)
    } finally {
      setBusyKey(null)
    }
  }

  const approveTx = (tx: Transaction) =>
    run(`tx:${tx.id}`, () => updateTx(tx.id, { approvalStatus: 'approved', approvedAt: new Date().toISOString() }))
  // Reddet = mevcut remove akışı: soft delete + Undo toast (geri alınabilir)
  const rejectTx = (tx: Transaction) => run(`tx:${tx.id}`, () => removeTx(tx.id))

  return (
    <div
      className={[
        'fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[400px]',
        'z-50 rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col',
      ].join(' ')}
      role="dialog"
      aria-label="Bildirimler"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold text-foreground">Bildirimler</span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent text-sm transition-colors"
          aria-label="Kapat"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto max-h-[70vh]">
        {due.length === 0 && upcoming.length === 0 && (
          <EmptyState icon="🔔" title="Bekleyen bildirim yok" description="Onay bekleyen veya yaklaşan işleminiz bulunmuyor." />
        )}

        {/* ── Onay bekleyen ─────────────────────────────────────────── */}
        {due.length > 0 && (
          <section>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-orange-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
              Onay bekleyen — {due.length}
            </div>
            <div className="divide-y divide-border">
              {due.map(n => n.kind === 'recurring-due' ? (
                <RowShell key={`rd:${n.recurring.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {categoryOf(n.recurring.categoryId) && (
                        <CategoryIcon
                          icon={categoryOf(n.recurring.categoryId)!.icon}
                          color={categoryOf(n.recurring.categoryId)!.color}
                          size={14}
                        />
                      )}
                      <span className="text-sm font-semibold text-foreground truncate">{n.recurring.name}</span>
                      <Badge variant={n.recurring.type === 'income' ? 'ok' : n.recurring.type === 'transfer' ? 'info' : 'danger'}>
                        {FREQ_LABEL[n.recurring.frequency]}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[accountName(n.recurring.accountId), fmtDay(n.dueSince)].filter(Boolean).join(' · ')}
                      {n.missedCount > 1 && ` · ${n.missedCount} dönem birikti`}
                    </div>
                    <RowActions>
                      <button
                        className={primaryBtn}
                        disabled={busyKey !== null}
                        onClick={() => run(`rec:${n.recurring.id}`, () => approveRecurring(n.recurring))}
                      >
                        {busyKey === `rec:${n.recurring.id}` ? 'Onaylanıyor…' : 'Onayla'}
                      </button>
                      <button
                        className={ghostBtn}
                        disabled={busyKey !== null}
                        onClick={() => run(`rec-skip:${n.recurring.id}`, () => skipRecurring(n.recurring.id))}
                        title="Bu dönemleri üretmeden atla"
                      >
                        Atla
                      </button>
                    </RowActions>
                  </div>
                  <AmountText type={n.recurring.type} amount={n.recurring.amount} currency={n.recurring.currency} />
                </RowShell>
              ) : (
                <RowShell key={`td:${n.tx.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {categoryOf(n.tx.categoryId) && (
                        <CategoryIcon
                          icon={categoryOf(n.tx.categoryId)!.icon}
                          color={categoryOf(n.tx.categoryId)!.color}
                          size={14}
                        />
                      )}
                      <span className="text-sm font-semibold text-foreground truncate">{n.tx.description}</span>
                      <Badge variant="amber">{TYPE_LABEL[n.tx.type]}</Badge>
                      {n.tx.isInstallment && (
                        <span className="text-[10px] text-orange-500/80 flex-shrink-0">
                          {n.tx.installIndex}/{n.tx.installTotal}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[accountName(n.tx.accountId), fmtDay(n.tx.date)].filter(Boolean).join(' · ')}
                    </div>
                    <RowActions>
                      <button className={primaryBtn} disabled={busyKey !== null} onClick={() => approveTx(n.tx)}>
                        {busyKey === `tx:${n.tx.id}` ? 'Onaylanıyor…' : 'Onayla'}
                      </button>
                      <button
                        className={dangerBtn}
                        disabled={busyKey !== null}
                        onClick={() => rejectTx(n.tx)}
                        title="İşlemi sil (geri alınabilir)"
                      >
                        Reddet
                      </button>
                    </RowActions>
                  </div>
                  <AmountText type={n.tx.type} amount={n.tx.amount} currency={n.tx.currency} />
                </RowShell>
              ))}
            </div>
          </section>
        )}

        {/* ── Yaklaşan (7 gün) ─────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <section className={due.length > 0 ? 'border-t border-border' : ''}>
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Yaklaşan — {upcoming.length}
            </div>
            <div className="divide-y divide-border">
              {upcoming.map(n => n.kind === 'recurring-upcoming' ? (
                <RowShell key={`ru:${n.recurring.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {categoryOf(n.recurring.categoryId) && (
                        <CategoryIcon
                          icon={categoryOf(n.recurring.categoryId)!.icon}
                          color={categoryOf(n.recurring.categoryId)!.color}
                          size={14}
                        />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">{n.recurring.name}</span>
                      <Badge variant="secondary">{FREQ_LABEL[n.recurring.frequency]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[accountName(n.recurring.accountId), fmtDay(n.recurring.nextDueDate)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <AmountText type={n.recurring.type} amount={n.recurring.amount} currency={n.recurring.currency} />
                </RowShell>
              ) : (
                <RowShell key={`tu:${n.tx.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {categoryOf(n.tx.categoryId) && (
                        <CategoryIcon
                          icon={categoryOf(n.tx.categoryId)!.icon}
                          color={categoryOf(n.tx.categoryId)!.color}
                          size={14}
                        />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">{n.tx.description}</span>
                      {n.tx.isInstallment && (
                        <span className="text-[10px] text-orange-500/80 flex-shrink-0">
                          {n.tx.installIndex}/{n.tx.installTotal}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {[accountName(n.tx.accountId), fmtDay(n.tx.date)].filter(Boolean).join(' · ')}
                    </div>
                    <RowActions>
                      <button
                        className={ghostBtn}
                        disabled={busyKey !== null}
                        onClick={() => approveTx(n.tx)}
                        title="Tarihini beklemeden onayla — tarihi gelince bakiyeye işlenir"
                      >
                        {busyKey === `tx:${n.tx.id}` ? 'Onaylanıyor…' : 'Şimdi onayla'}
                      </button>
                    </RowActions>
                  </div>
                  <AmountText type={n.tx.type} amount={n.tx.amount} currency={n.tx.currency} />
                </RowShell>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
