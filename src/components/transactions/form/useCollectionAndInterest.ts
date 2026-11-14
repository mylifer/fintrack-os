import { useMemo } from 'react'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { baseAmount } from '@/lib/utils/fx'
import { isDebtCollectionTx } from '@/lib/utils/calculations'
import { interestTaxId, isInterestCategory, splitInterest } from '@/lib/utils/interest-tax'
import { DEFAULT_DEPOSIT_TAX } from '@/lib/utils/deposit'
import type { DraftSplit } from '@/lib/utils/categorySplits'
import type { Account, Category, Debt, Transaction } from '@/types'
import type { Tab, TxForm } from './form-model'

// Gelir sekmesinin türetilmiş verileri: alacak tahsilatı ve faiz stopajı.
export function useCollectionAndInterest({
  tab, form, amountStr, isEdit, isRecurring, isPlannedEdit, sessionEditId, editingTx, splits,
  allDebts, transactions, categories, accounts, interestMode, interestRateStr,
}: {
  tab: Tab
  form: TxForm
  amountStr: string
  isEdit: boolean
  isRecurring: boolean
  isPlannedEdit: boolean
  sessionEditId: string | null
  editingTx: Transaction | undefined
  splits: DraftSplit[] | null
  allDebts: Debt[]
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  interestMode: 'net' | 'gross'
  interestRateStr: string | null
}) {
  // ── Alacak tahsilatı (gelir sekmesi) ───────────────────────────────────
  // Gelir, bana verilmiş bir borcun geri ödemesiyse kategori yerine alacak
  // seçilir: tutar alacaktan düşer ve satır gelir sayılmaz (isDebtCollectionTx).
  // Tekrarlayan şablonda ve art arda oturum satırı düzeltilirken yoktur —
  // transferdeki "Borç" seçeneğiyle aynı sınır.
  const editDebtLinkId = editingTx?.debtId
  const receivables = useMemo(
    () => allDebts.filter(d => d.direction === 'owed' && (!d.isSettled || d.id === editDebtLinkId)),
    [allDebts, editDebtLinkId],
  )
  const isCollection = tab === 'income' && form.isDebtPayment
  const canCollect   = tab === 'income' && !isRecurring && !sessionEditId
    && (receivables.length > 0 || isCollection)
  // Seçili alacakta bu kayıttan ÖNCE kalan tutar. Düzenlemede satırın eski
  // payı alacağa geri eklenir (aynı alacak seçiliyse) — yoksa tutarı
  // değiştirmeden kaydetmek bile "kalandan fazla" hatası verirdi.
  const selectedReceivable = isCollection ? receivables.find(d => d.id === form.debtId) : undefined
  // ── Faiz stopajı (gelir sekmesi, Faiz kategorisi) ─────────────────────
  // Bankanın kestiği stopaj ayrı bir Vergi gideri olarak yazılır (bkz.
  // lib/utils/interest-tax). Yeni girişte Faiz kategorisi seçilince açılır;
  // düzenlemede yalnız satırın zaten bir stopaj kaydı varsa (eski faiz
  // satırlarına kullanıcı istemeden gider eklenmesin). Tekrarlayan şablon,
  // bölünmüş kategori ve art arda oturum satırı düzeltmesi dışarıda kalır.
  const linkedTaxTx = editingTx && !isPlannedEdit
    ? transactions.find(t => t.id === interestTaxId(editingTx.id))
    : undefined
  const isInterest = tab === 'income' && !form.isDebtPayment && !splits && !isRecurring && !sessionEditId
    && (!isEdit || !!linkedTaxTx)
    && isInterestCategory(form.categoryId, categories)
  const interestAccount = accounts.find(a => a.id === form.accountId)
  const defaultTaxRate  = interestAccount?.depositTaxPct ?? DEFAULT_DEPOSIT_TAX
  const taxRate = interestRateStr === null
    ? defaultTaxRate
    : (parseFloat(interestRateStr.replace(',', '.')) || 0)
  const interestSplit = isInterest
    ? splitInterest(parseCurrencyInput(amountStr), taxRate, interestMode)
    : null

  const receivableRemaining = selectedReceivable
    ? Math.round((selectedReceivable.totalAmount - selectedReceivable.paidAmount
        + (editingTx && isDebtCollectionTx(editingTx) && editingTx.debtId === selectedReceivable.id ? baseAmount(editingTx) : 0)) * 100) / 100
    : 0

  return {
    receivables, isCollection, canCollect, selectedReceivable, receivableRemaining,
    linkedTaxTx, isInterest, interestAccount, defaultTaxRate, taxRate, interestSplit,
  }
}
