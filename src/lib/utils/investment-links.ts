import type { InvestmentTransaction, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Satışa bağlı defter kayıtlarının (satış geliri + kâr/zarar satırı) silme
   hedeflerini çözer. Öncelik sırası:

   1. Her iki ID bağı da varsa → yalnız o iki kayıt. Aynı gün aynı varlıktan
      birden fazla satış olsa bile başka işleme dokunulmaz.
   2. Yalnız satış ID'si varsa (pnlLinkedTransactionId alanı eklenmeden önce
      yazılmış satırlar) → P&L kaydı açıklama+tarih eşleşmesiyle aranır.
   3. Hiç ID bağı yoksa (en eski satırlar) → açıklama+tarih eşleşmesi.

   Saf fonksiyon: store'a dokunmaz, silme kararını test edilebilir kılar.
──────────────────────────────────────────────────────────────────────── */

type LinkedTxCandidate = Pick<Transaction, 'id' | 'type' | 'accountId' | 'date' | 'description'>

export function sellCleanupTxIds(
  investTx: Pick<InvestmentTransaction, 'targetAccountId' | 'date' | 'linkedTransactionId' | 'pnlLinkedTransactionId'>,
  label: string,
  transactions: readonly LinkedTxCandidate[],
): string[] {
  if (!investTx.targetAccountId) return []

  if (investTx.linkedTransactionId) {
    if (investTx.pnlLinkedTransactionId) {
      return [investTx.linkedTransactionId, investTx.pnlLinkedTransactionId]
    }
    const pnlTx = transactions.find(t =>
      t.accountId === investTx.targetAccountId &&
      t.date === investTx.date &&
      (t.description === `${label} Satış Kârı` || t.description === `${label} Satış Zararı`),
    )
    return pnlTx
      ? [investTx.linkedTransactionId, pnlTx.id]
      : [investTx.linkedTransactionId]
  }

  return transactions
    .filter(t =>
      (t.type === 'income' || t.type === 'expense') &&
      t.accountId === investTx.targetAccountId &&
      t.date === investTx.date &&
      t.description.includes(label) &&
      t.description.includes('Satış'),
    )
    .map(t => t.id)
}
