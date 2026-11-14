import { Wallet, CreditCard, Repeat } from 'lucide-react'
import { SUBSCRIPTION_TAG, isSubscriptionTag, detectBrand } from '@/lib/subscriptions/brands'
import type { Transaction } from '@/types'
import type { Tab, TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

export type PayType = 'one' | 'installment' | 'subscription'

export function usePaymentType({
  form, patch, tab, isEdit, isRecurring, editingTx, isPlannedEdit, sessionEditId, installGroup,
  setInstallments, setManualAmounts,
}: {
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  tab: Tab
  isEdit: boolean
  isRecurring: boolean
  editingTx: Transaction | undefined
  isPlannedEdit: boolean
  sessionEditId: string | null
  installGroup: Transaction[]
  setInstallments: TransactionFormState['setInstallments']
  setManualAmounts: TransactionFormState['setManualAmounts']
}) {
  // Subscription toggle — marks an expense with the reserved tag. Derives its
  // checked state from the tag list (case-insensitive) and toggles it without
  // disturbing other tags; the existing dedupeTags-on-submit flow keeps it tidy.
  const isSubscription = form.tags.some(isSubscriptionTag)
  const toggleSubscription = (on: boolean) => {
    if (on) {
      if (!form.tags.some(isSubscriptionTag)) patch({ tags: [...form.tags, SUBSCRIPTION_TAG] })
    } else {
      patch({ tags: form.tags.filter(t => !isSubscriptionTag(t)) })
    }
  }
  const subBrand = isSubscription ? detectBrand(form.description) : null

  // ── Ödeme tipi ──────────────────────────────────────────────────────────
  // Abonelik ve taksit aynı sorunun cevabı ("bu gider nasıl ödeniyor"), o
  // yüzden tek bir segmentte toplanır. Seçenek kümesi duruma göre daralır:
  // taksit yalnızca yeni kayıtta ya da taksitli bir grup düzenlenirken anlamlı.
  const canSubscription = !isRecurring && tab === 'expense'
  // Var olan tekil bir işlem SONRADAN taksitlendirilebilir: satır 1. taksit
  // olur (id korunur), kalan taksitler üretilir. Mutabakat gerektiren bağları
  // olan satırlar dışarıda kalır — borç ödemesi, çalışma alanları arası
  // transfer bacağı, iade (negatif tutar / refundOfId) ve sistem kayıtları.
  const convertibleTx = !!editingTx && !isPlannedEdit && !editingTx.isInstallment
    && !editingTx.installGroupId && !editingTx.debtId && !editingTx.workspaceTransferId
    && !editingTx.systemKind && !editingTx.refundOfId && editingTx.amount > 0
  const canInstallment  = canSubscription && !sessionEditId
    && (!isEdit || installGroup.length > 0 || convertibleTx)
  // Taksitli grup düzenlenirken taksit KAPATILAMAZ: grubu tekil işleme
  // dönüştürme mutabakatı bu modalda yürütülmüyor (eskiden de checkbox
  // yerine sabit başlık gösteriliyordu). Segment kilitli görünür.
  const installmentLocked = canInstallment && isEdit && installGroup.length > 0
  // Segment tek seçimli; eski kayıtlarda ikisi birden işaretli olabilir —
  // taksit öncelenir, abonelik etiketi Etiketler alanında görünür kalır
  // (etiket silinmez, veri kaybı olmaz).
  const payType: PayType = form.isInstallment ? 'installment'
    : isSubscription ? 'subscription'
    : 'one'
  // Taksit seçeneği kullanılamaz durumdayken bile mevcut seçimse gösterilir,
  // yoksa segmentte hiçbir şey aktif görünmez.
  const payTypeOptions = ([
    { key: 'one',          label: 'Tek çekim', Icon: Wallet,     show: true },
    { key: 'installment',  label: 'Taksitli',  Icon: CreditCard, show: canInstallment || payType === 'installment' },
    { key: 'subscription', label: 'Abonelik',  Icon: Repeat,     show: canSubscription },
  ] as const).filter(o => o.show)

  const selectPayType = (next: PayType) => {
    if (installmentLocked || next === payType) return
    if (next === 'installment') {
      patch({ isInstallment: true })
      // Taksit anlamlı olsun diye en az 2'ye çekilir (tekil işlemde sayaç 1'dir).
      setInstallments(n => Math.max(2, n))
    } else if (form.isInstallment) {
      patch({ isInstallment: false })
      setManualAmounts(null)
    }
    toggleSubscription(next === 'subscription')
  }

  return {
    isSubscription, subBrand, canSubscription, convertibleTx, canInstallment, installmentLocked,
    payType, payTypeOptions, selectPayType,
  }
}

export type PaymentType = ReturnType<typeof usePaymentType>
