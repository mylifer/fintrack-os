'use client'

import { TransactionList } from '@/components/transactions/TransactionList'
import type { TxViewProps } from './shared'

/* ── Kompakt görünüm ─────────────────────────────────────────────────────────
   Yoğun tek satırlık liste: ikon, açıklama, meta alt satırda, tutar sağda.
   Sütun yok — çok sayıda işlemi en az dikey alanda taramak için. Toplu seçim
   bu düzende yoktur (satırda onay kutusu yeri yok); tablo görünümünü kullanın. */
export function CompactView({
  transactions, account, projectedIds, sort,
  emptyTitle, emptyDescription, onPersonClick, heightClass,
}: TxViewProps) {
  return (
    <TransactionList
      heightClass={heightClass}
      transactions={transactions}
      projectedIds={projectedIds}
      layout="cards"
      sort={sort}
      showAccount={false}
      primaryAccountId={account.id}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      onPersonClick={onPersonClick}
    />
  )
}
