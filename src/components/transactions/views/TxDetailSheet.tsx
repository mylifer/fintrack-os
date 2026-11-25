'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore, useUIStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { awaitsApproval } from '@/lib/utils/calculations'
import { DEFAULT_ICON } from '@/lib/category-palette'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { DeleteConfirmDialog } from '@/components/transactions/TransactionList'
import {
  IndigoSheet, KeyValueList, SheetButtons, sheetBtnPrimary, sheetBtnSecondary,
} from '@/components/accounts/indigo/IndigoSheet'
import type { Account, Transaction } from '@/types'

/* İşlem ayrıntısı — İndigo alt paneli. Kendi düzenleme formu YOK: Düzenle /
   İade / Sil mevcut modal ve onay akışlarını çağırır, kurallar tek yerde. */
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

  const isXfer   = live.type === 'transfer'
  const incoming = isXfer && live.toAccountId === account.id
  const isRefund = live.type === 'expense' && live.amount < 0
  const positive = live.type === 'income' || isRefund || incoming
  const todayStr = today()
  const typeLabel = isXfer ? (incoming ? 'Gelen transfer' : 'Giden transfer') : live.type === 'income' ? 'Gelir' : isRefund ? 'İade' : 'Gider'

  const rows: [string, React.ReactNode][] = [
    ['Kategori', cat ? <Link href={`/categories/${cat.id}`} className="hover:underline">{cat.name}</Link> : 'Kategorisiz'],
    ['Tür', typeLabel],
    [account.type === 'credit_card' ? 'Kart' : 'Hesap', account.name],
  ]
  if (other) rows.push([incoming ? 'Gönderen hesap' : 'Hedef hesap', <Link key="o" href={`/accounts/${other.id}`} className="hover:underline">{other.name}</Link>])
  if (recipient) rows.push(['Alıcı', <Link key="r" href={`/alicilar/${recipient.id}`} className="hover:underline">{recipient.name}</Link>])
  if (family) rows.push(['Aile üyesi', <Link key="f" href={`/aile-uyeleri/${family.id}`} className="hover:underline">{family.name}</Link>])
  if (live.tags?.length) rows.push(['Etiketler', live.tags.join(' ')])
  if (live.notes) rows.push(['Not', live.notes])
  if (plan) rows.push(['Toplam', `${formatCurrency(plan.reduce((s, t) => s + Math.abs(t.amount), 0), live.currency)} · ${plan.length} taksit`])

  return (
    <IndigoSheet title={live.description} onClose={onClose} hideTitle>
      <div className="flex flex-col items-center gap-2 pb-4 text-center">
        <CategoryIcon icon={cat?.icon ?? DEFAULT_ICON} color={cat?.color ?? '#94a3b8'} size={34} className="!rounded-[20px]" />
        <div className="text-xl font-extrabold">{live.description}</div>
        <div className={`text-[40px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums ${positive ? 'text-[var(--ip-pos)]' : ''}`}>
          {positive ? '+' : isXfer ? '' : '−'}{formatCurrency(Math.abs(live.amount), live.currency)}
        </div>
        <span className="text-sm text-[var(--ip-sub)]">{formatDate(live.date.slice(0, 10), 'd MMMM yyyy, EEEE')}</span>
        {(projected || awaitsApproval(live)) && (
          <div className="flex gap-1.5">
            {projected && <span className="rounded-full bg-[var(--ip-accent)]/15 px-2.5 py-0.5 text-xs font-bold text-[var(--ip-accent)]">Planlandı</span>}
            {awaitsApproval(live) && <span className="rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-bold text-orange-600">Onay bekliyor</span>}
          </div>
        )}
      </div>

      <KeyValueList rows={rows} />

      {plan && (
        <div className="mt-[18px]">
          <b>Taksit planı</b>
          <div className="mt-2.5 mb-1 flex gap-1.5" aria-hidden="true">
            {plan.map(p => (
              <i key={p.id} className={`h-2 flex-1 rounded-full ${p.date.slice(0, 10) <= todayStr ? 'bg-[var(--ip-accent)]' : 'bg-[var(--ip-fg)]/15'}`} />
            ))}
          </div>
          <KeyValueList rows={plan.map((p, i) => [
            `${p.installIndex ?? i + 1}/${p.installTotal ?? plan.length} · ${formatDate(p.date.slice(0, 10), 'd MMM')}${p.id === live.id ? ' (bu)' : ''}`,
            <span key={p.id} className="tabular-nums">
              {formatCurrency(Math.abs(p.amount), p.currency)}{' '}
              <span className="font-medium text-[var(--ip-sub)]">{p.date.slice(0, 10) <= todayStr ? '· işlendi' : '· bekliyor'}</span>
            </span>,
          ])} />
        </div>
      )}

      {projected ? (
        <SheetButtons>
          <button type="button" className={sheetBtnSecondary} onClick={onClose}>Kapat</button>
          <button
            type="button"
            className={sheetBtnPrimary}
            onClick={() => { onClose(); openModal('edit-transaction', { id: live.id, plannedTx: live }) }}
          >
            Tarihi düzenle
          </button>
        </SheetButtons>
      ) : (
        <>
          <SheetButtons>
            <button type="button" className={sheetBtnSecondary} onClick={onClose}>Kapat</button>
            <button
              type="button"
              className={sheetBtnPrimary}
              onClick={() => { onClose(); openModal('edit-transaction', { id: live.id }) }}
            >
              Düzenle
            </button>
          </SheetButtons>
          <div className="mt-3 flex justify-center gap-6 text-sm font-bold">
            {live.type === 'expense' && live.amount > 0 && (
              <button
                type="button"
                className="text-[var(--ip-accent)] hover:underline"
                onClick={() => { onClose(); openModal('refund-transaction', { id: live.id }) }}
              >
                İade işle
              </button>
            )}
            <DeleteConfirmDialog
              tx={live}
              onDelete={() => removeTx(live.id)}
              onSettled={onClose}
              trigger={<button type="button" className="text-[var(--ip-neg)] hover:underline">İşlemi sil</button>}
            />
          </div>
        </>
      )}
    </IndigoSheet>
  )
}
