'use client'

import { TransactionList } from '@/components/transactions/TransactionList'
import type { TxViewProps } from './shared'

/* ── Tablo görünümü ──────────────────────────────────────────────────────────
   Mevcut defter tablosu: sütunlu, güncel bakiyeli, toplu seçim destekli.
   Varsayılan görünüm — en çok bilgiyi tek satırda veren düzen. */
export function TableView({
  transactions, account, projectedIds, plannedTxs, sort,
  emptyTitle, emptyDescription, onPersonClick, heightClass,
  selectable, selectedIds, onToggleSelect, onSelectMany,
}: TxViewProps) {
  return (
    <TransactionList
      heightClass={heightClass}
      transactions={transactions}
      projectedIds={projectedIds}
      plannedTxs={plannedTxs}
      layout="table"
      sort={sort}
      showAccount={false}
      primaryAccountId={account.id}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      onPersonClick={onPersonClick}
      selectable={selectable}
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      onSelectMany={onSelectMany}
    />
  )
}
