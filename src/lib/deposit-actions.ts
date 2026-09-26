import { useAccountStore } from '@/store/accounts.store'
import { useTransactionStore } from '@/store/transactions.store'
import { useCategoryStore } from '@/store/categories.store'
import { foldText } from '@/lib/auto-category'
import { depositTerms, projectDeposit, rolledTerms } from '@/lib/utils/deposit'
import type { Account, Transaction } from '@/types'

/* Vadesi dolan mevduatın NET faizini deftere işler (banka stopajı keserek
   yatırır) ve vadeyi ya aynı süreyle yeniler ya da kapatır. Faiz satırının
   tarihi vade sonudur — bakiye geçmişi bankadaki gibi o gün artar.

   Çift işleme koruması: koşullar ya ileri kayar (yenile) ya da silinir
   (bitir); aynı vade ikinci kez "dolmuş" görünmez. */

/** "Faiz", "Faiz Geliri", "Mevduat Faizi" … — adında faiz geçen ilk gelir kategorisi. */
function interestCategoryId(): string | undefined {
  return useCategoryStore.getState().categories
    .find(c => c.scope === 'income' && !c.isArchived && foldText(c.name).includes('faiz'))?.id
}

export async function processDepositInterest(account: Account, opts: { renew: boolean }): Promise<number> {
  const terms = depositTerms(account)
  if (!terms) return 0
  const p = projectDeposit(account.balance, terms, terms.end)

  if (p.net >= 0.01) {
    const now = new Date().toISOString()
    const tx: Transaction = {
      id:            crypto.randomUUID(),
      type:          'income',
      amount:        p.net,
      currency:      account.currency,
      date:          terms.end,
      accountId:     account.id,
      categoryId:    interestCategoryId(),
      description:   `Vadeli mevduat faizi (net, %${terms.rate.toLocaleString('tr-TR')})`,
      isInstallment: false,
      createdAt:     now,
      updatedAt:     now,
    }
    await useTransactionStore.getState().add(tx)
  }

  const next = opts.renew ? rolledTerms(terms) : null
  await useAccountStore.getState().update(account.id, {
    depositRate:   next?.rate ?? null,
    depositStart:  next?.start ?? null,
    depositEnd:    next?.end ?? null,
    depositTaxPct: next?.taxPct ?? null,
  })
  useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)
  return p.net
}
