import { useState } from 'react'
import { useTransactionStore } from '@/store'
import { sumMoney } from '@/lib/utils/money'
import { impliedTaxRate, interestTaxId } from '@/lib/utils/interest-tax'
import { rescaleSplits, type DraftSplit } from '@/lib/utils/categorySplits'
import type { Transaction, ModalPayload, RecurringTransaction } from '@/types'
import {
  buildInitialForm, newRecurringForm, recallKeepOpen, toAmountStr,
  type Tab, type SessionRow,
} from './form-model'

// İşlem formunun tüm yerel durumu. Modal her açılışta `key` ile yeniden
// bağlandığından (bkz. app/(main)/layout.tsx) tohumlar yalnızca ilk render'da okunur.
export function useTransactionFormState({
  isEdit, editingTx, editingRec, modalPayload, installGroup,
}: {
  isEdit: boolean
  editingTx: Transaction | undefined
  editingRec: RecurringTransaction | undefined
  modalPayload: ModalPayload | null
  installGroup: Transaction[]
}) {
  // Lazy initializers run exactly once — the component is remounted (keyed) per
  // open, so first-render values (editingTx / modalPayload) are the correct seed.
  const [tab, setTab]             = useState<Tab>(() =>
    editingRec ? editingRec.type as Tab : isEdit && editingTx ? editingTx.type as Tab : 'expense')
  const [form, setForm]           = useState(() => {
    const f = buildInitialForm(isEdit, editingTx, editingRec, modalPayload)
    // Taksitli grup düzenleniyorsa tarih ilk taksitinki olsun (ilk-giriş görünümü).
    if (installGroup.length) f.date = installGroup[0].date
    return f
  })
  const [rec, setRec]             = useState(() => editingRec
    ? {
        name:       editingRec.name,
        frequency:  editingRec.frequency,
        startDate:  editingRec.startDate,
        endDate:    editingRec.endDate ?? '',
      }
    : newRecurringForm())
  const [amountStr, setAmountStr] = useState(() => {
    // Taksitli grup düzenleniyorsa 'Tutar' toplamı gösterir (ilk-giriş gibi).
    const seed = installGroup.length
      ? sumMoney(installGroup.map(t => t.amount))
      : editingRec?.amount ?? (isEdit && editingTx ? editingTx.amount : undefined)
    return seed !== undefined
      ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2, useGrouping: false }).format(Math.abs(seed))
      : ''
  })
  // Sign of the amount. Always +1 except when editing a refund (negative
  // expense), where we preserve the negative so a save doesn't flip it positive.
  const [amountSign, setAmountSign] = useState(() => isEdit && editingTx && editingTx.amount < 0 ? -1 : 1)
  // Faiz stopajı: girilen tutar net (bankanın yatırdığı) mı brüt mü; oran
  // null = hesabın mevduat stopajı / varsayılan. Düzenlemede kayıtlı satır
  // brüttür ve oran kayıtlı stopajdan geri çıkarılır.
  const [interestMode, setInterestMode] = useState<'net' | 'gross'>(() => {
    if (!isEdit || !editingTx) return 'net'
    return 'gross'
  })
  const [interestRateStr, setInterestRateStr] = useState<string | null>(() => {
    if (!isEdit || !editingTx) return null
    const tax = useTransactionStore.getState().transactions.find(t => t.id === interestTaxId(editingTx.id))
    return tax ? String(impliedTaxRate(editingTx.amount, tax.amount)).replace('.', ',') : null
  })
  const [installments, setInstallments] = useState(() =>
    installGroup.length || (isEdit && editingTx ? (editingTx.installTotal ?? 1) : 1))
  // Elle düzenlenen taksit tutarları (amountStr formatında raw string'ler).
  // null → otomatik bölüşüm (splitInstallments: banka kuralı). Toplam tutar veya taksit sayısı
  // değişince elle girilenler geçersizleşir, otomatiğe dönülür (onChange'lerde
  // sıfırlanır — effect içinde setState lint'e takılıyor). Taksitli grup
  // düzenleniyorsa mevcut taksit tutarlarıyla tohumlanır (gerçek tutarlar görünür).
  const [manualAmounts, setManualAmounts] = useState<string[] | null>(() =>
    installGroup.length ? installGroup.map(t => toAmountStr(t.amount)) : null)
  // ── Çoklu kategori (oran barı) ─────────────────────────────────────────
  // null → bölme kapalı (tek kategori, alan bugünkü haliyle çalışır).
  // Paylar BÜYÜKLÜK uzayında tutulur; işaret kayıtta amountSign ile verilir.
  // Taksitli grup düzenlenirken paylar TOPLAM tutara ölçeklenir (ilk-giriş
  // görünümüyle tutarlı: satır satır değil, satın almanın tamamı üzerinden).
  // Kayıtlı paylar SABİT gelir: düzenlemede kullanıcının bir kez verdiği
  // tutarlar kendiliğinden oynamaz (tutar değişirse kalanı son pay yutar).
  const [splits, setSplits] = useState<DraftSplit[] | null>(() => {
    const src = installGroup.length ? installGroup[0].categorySplits : editingTx?.categorySplits
    if (!src?.length || src.length < 2) return null
    const magnitude = src.map(s => ({ ...s, amount: Math.abs(s.amount) }))
    const totalSeed = installGroup.length
      ? sumMoney(installGroup.map(t => Math.abs(t.amount)))
      : Math.abs(editingTx?.amount ?? 0)
    return rescaleSplits(magnitude, totalSeed).map(s => ({ ...s, pinned: true }))
  })
  // Otomatik seçilen kategori (yoksa null): kullanıcı elle seçene kadar
  // açıklama/alıcı değiştikçe güncellenebilir — bkz. withAutoCategory.
  const [autoCategory, setAutoCategory] = useState<string | null>(null)

  const [loading, setLoading]     = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

  // ── Art arda ekleme (oturum) ───────────────────────────────────────────
  // Açıkken Kaydet modalı kapatmaz: satır store'a yazılır, footer'ın üstündeki
  // oturum listesine düşer ve form bir sonraki giriş için sıfırlanır.
  const [keepOpen, setKeepOpen]           = useState(recallKeepOpen)
  const [session, setSession]             = useState<SessionRow[]>([])
  const [sessionEditId, setSessionEditId] = useState<string | null>(null)

  return {
    tab, setTab,
    form, setForm,
    rec, setRec,
    amountStr, setAmountStr,
    amountSign, setAmountSign,
    interestMode, setInterestMode,
    interestRateStr, setInterestRateStr,
    installments, setInstallments,
    manualAmounts, setManualAmounts,
    splits, setSplits,
    autoCategory, setAutoCategory,
    loading, setLoading,
    errors, setErrors,
    keepOpen, setKeepOpen,
    session, setSession,
    sessionEditId, setSessionEditId,
  }
}

export type TransactionFormState = ReturnType<typeof useTransactionFormState>
