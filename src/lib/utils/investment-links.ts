import type { InvestmentTransaction, Transaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Satışa bağlı defter kayıtlarının (satış geliri + kâr/zarar + stopaj satırı) silme
   hedeflerini çözer. Öncelik sırası:

   1. ID bağları varsa → yalnız o kayıtlar (satış + kâr/zarar + stopaj). Aynı
      gün aynı varlıktan birden fazla satış olsa bile başka işleme dokunulmaz.
   2. Yalnız satış ID'si varsa (pnlLinkedTransactionId alanı eklenmeden önce
      yazılmış satırlar) → P&L kaydı açıklama+tarih eşleşmesiyle aranır.
   3. Hiç ID bağı yoksa (en eski satırlar) → açıklama+tarih eşleşmesi.

   Saf fonksiyon: store'a dokunmaz, silme kararını test edilebilir kılar.
──────────────────────────────────────────────────────────────────────── */

type LinkedTxCandidate = Pick<Transaction, 'id' | 'type' | 'accountId' | 'date' | 'description'>

export function sellCleanupTxIds(
  investTx: Pick<InvestmentTransaction, 'targetAccountId' | 'date' | 'linkedTransactionId' | 'pnlLinkedTransactionId' | 'taxLinkedTransactionId'>,
  label: string,
  transactions: readonly LinkedTxCandidate[],
): string[] {
  if (!investTx.targetAccountId) return []

  if (investTx.linkedTransactionId) {
    const ids = [investTx.linkedTransactionId]

    if (investTx.pnlLinkedTransactionId) {
      ids.push(investTx.pnlLinkedTransactionId)
    } else {
      const pnlTx = transactions.find(t =>
        t.accountId === investTx.targetAccountId &&
        t.date === investTx.date &&
        (t.description === `${label} Satış Kârı` || t.description === `${label} Satış Zararı`),
      )
      if (pnlTx) ids.push(pnlTx.id)
    }

    // Stopaj satırı (TEFAS) yalnız ID bağıyla çözülür — açıklama fallback'i YOK.
    // Bu satırı üreten kod ID'yi HER ZAMAN yazar, dolayısıyla bağı olmayan bir
    // satışın stopaj satırı da yoktur; açıklama eşleşmesi burada yalnızca aynı
    // gün/aynı fon ikinci bir satışın kesintisini yanlışlıkla silme riski katardı.
    if (investTx.taxLinkedTransactionId) ids.push(investTx.taxLinkedTransactionId)

    return ids
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
