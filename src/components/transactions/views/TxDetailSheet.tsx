'use client'

import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore, useUIStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { awaitsApproval } from '@/lib/utils/calculations'
import { DEFAULT_ICON } from '@/lib/category-palette'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog, TxIcon } from '@/components/transactions/TransactionList'
import type { Account, Transaction } from '@/types'

/* İşlem ayrıntı paneli — Akış görünümünde satıra dokununca açılır. Telefonda
   alttan çıkan bir sayfa, geniş ekranda sağ kenara yaslanan bir panel. Kendi
   düzenleme formu YOK: Düzenle / İade / Sil mevcut modal ve onay akışlarını
   çağırır, böylece kurallar tek yerde kalır. */
export function TxDetailSheet({
  tx, account, projected, onClose,
}: {
  tx: Transaction
  account: Account
  projected: boolean
  onClose: () => void
}) {
  const categories = useCategoryStore(s => s.categories)
  const accounts   = useAccountStore(s => s.accounts)
  const people     = usePeopleStore(s => s.people)
  const allTxs     = useTransactionStore(s => s.transactions)
  const removeTx   = useTransactionStore(s => s.remove)
  const openModal  = useUIStore(s => s.openModal)
  const closeRef   = useRef<HTMLButtonElement>(null)

  // Liste yenilenince (düzenleme sonrası) panel güncel kaydı göstersin
  const live = allTxs.find(t => t.id === tx.id) ?? tx
  const cat = live.categoryId ? categories.find(c => c.id === live.categoryId) : undefined
  const recipient = live.recipientId ? people.find(p => p.id === live.recipientId) : undefined
  const family = live.familyMemberId ? people.find(p => p.id === live.familyMemberId) : undefined
  const other = live.type === 'transfer'
    ? accounts.find(a => a.id === (live.toAccountId === account.id ? live.accountId : live.toAccountId))
    : undefined

  const plan = useMemo(() => {
    if (!live.installGroupId) return null
    return allTxs.filter(t => t.installGroupId === live.installGroupId).sort((a, b) => a.date.localeCompare(b.date))
  }, [allTxs, live.installGroupId])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])

  const isXfer   = live.type === 'transfer'
  const incoming = isXfer && live.toAccountId === account.id
  const isRefund = live.type === 'expense' && live.amount < 0
  const positive = live.type === 'income' || isRefund || incoming
  const todayStr = today()
  const typeLabel = isXfer ? (incoming ? 'Gelen transfer' : 'Giden transfer') : live.type === 'income' ? 'Gelir' : isRefund ? 'İade' : 'Gider'

  const rows: [string, React.ReactNode][] = [
    ['Tür', typeLabel],
    ['Kategori', cat ? <Link href={`/categories/${cat.id}`} className="hover:underline">{cat.name}</Link> : 'Kategorisiz'],
    ['Hesap', account.name],
  ]
  if (other) rows.push([incoming ? 'Gönderen hesap' : 'Hedef hesap', <Link key="o" href={`/accounts/${other.id}`} className="hover:underline">{other.name}</Link>])
  if (recipient) rows.push(['Alıcı', <Link key="r" href={`/alicilar/${recipient.id}`} className="hover:underline">{recipient.name}</Link>])
  if (family) rows.push(['Aile üyesi', <Link key="f" href={`/aile-uyeleri/${family.id}`} className="hover:underline">{family.name}</Link>])
  if (live.tags?.length) rows.push(['Etiketler', live.tags.join(' ')])
  if (live.notes) rows.push(['Not', live.notes])
  if (plan) rows.push(['Toplam', `${formatCurrency(plan.reduce((s, t) => s + Math.abs(t.amount), 0), live.currency)} · ${plan.length} taksit`])

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" aria-label="Paneli kapat" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/40 animate-in fade-in" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-sheet-title"
        className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border-border bg-popover px-6 pt-3 pb-[calc(24px+env(safe-area-inset-bottom,0px))] text-popover-foreground shadow-2xl animate-in slide-in-from-bottom sm:inset-y-0 sm:left-auto sm:right-0 sm:bottom-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-l sm:pt-6 sm:slide-in-from-right"
      >
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-foreground/20 sm:hidden" aria-hidden="true" />
        <div className="flex justify-end">
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label="Kapat">
            <X />
          </Button>
        </div>

        <div className="flex flex-col items-center gap-2 pb-5 text-center">
          <TxIcon
            description={live.description}
            recipient={recipient}
            size={44}
            fallback={<CategoryIcon icon={cat?.icon ?? DEFAULT_ICON} color={cat?.color ?? '#94a3b8'} size={34} />}
          />
          <h2 id="tx-sheet-title" className="text-base font-semibold">{live.description}</h2>
          <div className={`text-3xl font-normal tabular-nums ${positive ? 'text-green-600' : ''}`}>
            {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(live.amount), live.currency)}
          </div>
          <div className="text-sm text-muted-foreground">{formatDate(live.date.slice(0, 10), 'd MMMM yyyy, EEEE')}</div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {projected && <span className="rounded-md bg-sky-500/12 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">Planlandı</span>}
            {awaitsApproval(live) && <span className="rounded-md bg-orange-500/12 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">Onay bekliyor</span>}
          </div>
        </div>

        <dl className="flex flex-col rounded-xl border border-border px-4">
          {rows.map(([k, v], i) => (
            <div key={k} className={`flex justify-between gap-4 py-3 text-sm ${i ? 'border-t border-border' : ''}`}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 min-w-0 text-right font-medium break-words">{v}</dd>
            </div>
          ))}
        </dl>

        {plan && (
          <div className="mt-5">
            <div className="mb-2 text-xs font-medium tracking-wide uppercase text-muted-foreground">Taksit planı</div>
            <div className="mb-3 flex gap-1.5" aria-hidden="true">
              {plan.map(p => (
                <span key={p.id} className={`h-2 flex-1 rounded-full ${p.date.slice(0, 10) <= todayStr ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </div>
            <dl className="flex flex-col rounded-xl border border-border px-4">
              {plan.map((p, i) => {
                const done = p.date.slice(0, 10) <= todayStr
                const me = p.id === live.id
                return (
                  <div key={p.id} className={`flex justify-between gap-4 py-2.5 text-sm ${i ? 'border-t border-border' : ''}`}>
                    <dt className={me ? 'font-semibold' : 'text-muted-foreground'}>
                      {p.installIndex ?? i + 1}/{p.installTotal ?? plan.length} · {formatDate(p.date.slice(0, 10), 'd MMM yyyy')}
                    </dt>
                    <dd className="m-0 tabular-nums">
                      {formatCurrency(Math.abs(p.amount), p.currency)}
                      <span className="ml-1.5 text-xs text-muted-foreground">{done ? 'işlendi' : 'bekliyor'}</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )}

        <div className="mt-6 flex gap-2.5">
          {projected ? (
            <Button
              size="lg"
              className="flex-1"
              onClick={() => { onClose(); openModal('edit-transaction', { id: live.id, plannedTx: live }) }}
            >
              Tarihi düzenle
            </Button>
          ) : (
            <>
              <DeleteConfirmDialog
                tx={live}
                onDelete={() => removeTx(live.id)}
                onSettled={onClose}
                trigger={
                  <Button size="lg" variant="destructive">Sil</Button>
                }
              />
              {live.type === 'expense' && live.amount > 0 && (
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => { onClose(); openModal('refund-transaction', { id: live.id }) }}
                >
                  İade işle
                </Button>
              )}
              <Button
                size="lg"
                className="flex-1"
                onClick={() => { onClose(); openModal('edit-transaction', { id: live.id }) }}
              >
                Düzenle
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
