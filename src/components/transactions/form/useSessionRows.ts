import { useMemo, type RefObject } from 'react'
import { useTransactionStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { sumMoney } from '@/lib/utils/money'
import type { CurrencyCode } from '@/types'
import { formForNextEntry, toAmountStr, type Tab, type TxForm, type SessionRow } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

export function useSessionRows({
  isEdit, isRecurring, crossWs, keepOpen, form, session, setSession, sessionEditId, setSessionEditId,
  setTab, setForm, setAutoCategory, setAmountStr, setAmountSign, setInstallments, setManualAmounts,
  setSplits, setErrors, amountInputRef,
}: {
  isEdit: boolean
  isRecurring: boolean
  crossWs: boolean
  keepOpen: boolean
  form: TxForm
  session: SessionRow[]
  amountInputRef: RefObject<HTMLInputElement | null>
} & Pick<TransactionFormState,
  | 'setSession' | 'sessionEditId' | 'setSessionEditId' | 'setTab' | 'setForm' | 'setAutoCategory'
  | 'setAmountStr' | 'setAmountSign' | 'setInstallments' | 'setManualAmounts' | 'setSplits' | 'setErrors'
>) {
  // ── Art arda ekleme yardımcıları ────────────────────────────────────────
  // Checkbox yalnızca YENİ tekil işlem eklerken anlamlı: düzenleme, tekrarlayan
  // şablon ve çalışma alanları arası transfer kendi tek-seferlik akışlarıdır.
  const canKeepOpen = !isEdit && !isRecurring && !crossWs

  // Bir sonraki giriş için formu topla: tip, hesap ve tarih taşınır; tutar,
  // açıklama, kategori, kişi, etiket, not ve taksit/borç ayarları temizlenir.
  function resetForNext(keepDate: string) {
    setForm(f => formForNextEntry(f.type, f.accountId, keepDate))
    setAutoCategory(null)
    setAmountStr('')
    setAmountSign(1)
    setInstallments(1)
    setManualAmounts(null)
    setSplits(null)
    setErrors({})
    requestAnimationFrame(() => amountInputRef.current?.focus())
  }

  // Oturum satırını forma geri yükler — Kaydet artık o satırı GÜNCELLER.
  function editSessionRow(row: SessionRow) {
    const tx = useTransactionStore.getState().transactions.find(t => t.id === row.id)
    if (!tx) return
    setTab(tx.type as Tab)
    setAutoCategory(null)
    setForm({
      type:           tx.type as Tab,
      amount:         tx.amount,
      currency:       tx.currency,
      date:           tx.date,
      accountId:      tx.accountId,
      toAccountId:    tx.toAccountId,
      categoryId:     tx.categoryId ?? '',
      description:    tx.description,
      notes:          tx.notes,
      tags:           tx.tags ?? [],
      isInstallment:  false,
      familyMemberId: tx.familyMemberId ?? undefined,
      recipientId:    tx.recipientId    ?? undefined,
      isDebtPayment:  false,
      debtId:         undefined,
    })
    setAmountStr(toAmountStr(Math.abs(tx.amount)))
    setAmountSign(tx.amount < 0 ? -1 : 1)
    setInstallments(1)
    setManualAmounts(null)
    setSplits(tx.categorySplits?.length && tx.categorySplits.length > 1
      ? tx.categorySplits.map(s => ({ ...s, amount: Math.abs(s.amount) }))
      : null)
    setErrors({})
    setSessionEditId(row.id)
    requestAnimationFrame(() => amountInputRef.current?.focus())
  }

  // Satırı sil: store'un normal silme yolu — taksitli grup birlikte gider,
  // borç katkısı geri alınır ve "geri al" toast'ı çıkar.
  async function removeSessionRow(row: SessionRow) {
    await useTransactionStore.getState().remove(row.id)
    setSession(rows => rows.filter(r => r.id !== row.id))
    if (sessionEditId === row.id) {
      setSessionEditId(null)
      resetForNext(form.date)
    }
  }

  // Oturum listesi görünürken form gövdesi kısalır; modalın toplam boyu
  // liste olmadığındakiyle aynı kalsın (dikeyde taşma olmasın).
  const showSession = canKeepOpen && keepOpen && session.length > 0

  // Oturum toplamı — para birimi başına ayrı (karışık kurlarda "₺1.240 · $30").
  const sessionTotals = useMemo(() => {
    const byCurrency = new Map<CurrencyCode, number>()
    session.forEach(r => byCurrency.set(r.currency, sumMoney([byCurrency.get(r.currency) ?? 0, r.amount])))
    return Array.from(byCurrency, ([cur, sum]) => formatCurrency(sum, cur)).join(' · ')
  }, [session])

  return { canKeepOpen, resetForNext, editSessionRow, removeSessionRow, showSession, sessionTotals }
}
