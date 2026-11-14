import { useRulesStore } from '@/store/rules.store'
import { parseCurrencyInput } from '@/lib/utils/currency'
import { keywordCategory, recipientCategory } from '@/lib/auto-category'
import { matchRule, ruleChanged, swapRuleExtras } from '@/lib/utils/transaction-rules'
import type { DraftSplit } from '@/lib/utils/categorySplits'
import type { Transaction, Category, Person } from '@/types'
import type { Tab, TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

export function useAutoCategory({
  tab, amountStr, form, patch, categories, allPeople, transactions,
  isEdit, isRecurring, splits, autoCategory, setAutoCategory,
}: {
  tab: Tab
  amountStr: string
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  categories: Category[]
  allPeople: Person[]
  transactions: Transaction[]
  isEdit: boolean
  isRecurring: boolean
  splits: DraftSplit[] | null
  autoCategory: string | null
  setAutoCategory: TransactionFormState['setAutoCategory']
}) {
  const rules = useRulesStore(s => s.rules)

  // ── Otomatik kategori (lib/auto-category) ──────────────────────────────
  // Önce açıklamadaki anahtar kelime kuralı, yoksa alıcının en sık kategorisi.
  // Yalnız kategori BOŞKEN ya da mevcut kategori yine bizim otomatik seçimimizken
  // devreye girer; elle seçilen kategoriye (ve bölmeye) dokunulmaz.
  // Kullanıcının işlem kuralları (lib/utils/transaction-rules) hepsinden ÖNCE
  // gelir; ilk eşleşen kural kazanır. Tutar/hesap koşulu formun o anki
  // değerleriyle denenir (tutar henüz girilmemişse tutar koşullu kural tutmaz).
  function ruleFor(description: string, amountRaw = amountStr) {
    if (tab === 'transfer') return undefined
    const amount = parseCurrencyInput(amountRaw)
    return matchRule(rules, {
      description, type: tab, accountId: form.accountId, amount: amount > 0 ? amount : undefined,
    }, categories, allPeople)
  }

  function autoPick(description: string, recipientId: string | null | undefined, amountRaw = amountStr): string | undefined {
    if (tab === 'transfer') return undefined
    return ruleFor(description, amountRaw)?.categoryId
      ?? keywordCategory(description, tab, categories)
      ?? (recipientId ? recipientCategory(recipientId, tab, transactions, categories) : undefined)
  }

  // Kuralın etiket ve alıcı eylemleri (yalnız yeni kayıtta). Önceki kuraldan
  // gelmiş olanlar yenisiyle değişir; kullanıcının seçtiği alıcıya ve girdiği
  // etiketlere dokunulmaz (bkz. swapRuleExtras).
  function withRuleExtras(p: Partial<TxForm>, amountRaw: string): Partial<TxForm> {
    if (tab === 'transfer' || isEdit || isRecurring) return p
    if (!('description' in p) && amountRaw === amountStr) return p
    const prev = ruleFor(form.description)
    const next = ruleFor(p.description ?? form.description, amountRaw)
    return { ...p, ...swapRuleExtras(form, prev, next) }
  }

  /** `amountRaw`: tutar alanı değişiyorsa YENİ değeri (state henüz güncellenmedi). */
  function withAutoCategory(p0: Partial<TxForm>, amountRaw = amountStr): Partial<TxForm> {
    const p = withRuleExtras(p0, amountRaw)
    if (tab === 'transfer' || splits) return p
    const current = form.categoryId ?? ''
    if (current && current !== autoCategory) return p
    const pick = autoPick(
      p.description ?? form.description,
      'recipientId' in p ? p.recipientId : form.recipientId,
      amountRaw,
    )
    setAutoCategory(pick ?? null)
    return { ...p, categoryId: pick ?? '' }
  }

  // Tutar değişince tutar koşullu kural tutmaya başlayabilir ya da bırakabilir:
  // eşleşen kural değiştiyse öneri yeniden uygulanır (elle seçilene dokunulmaz).
  function rerunRulesForAmount(raw: string) {
    if (tab === 'transfer' || !form.description.trim()) return
    if (!ruleChanged(ruleFor(form.description), ruleFor(form.description, raw))) return
    patch(withAutoCategory({}, raw))
  }

  return { autoPick, withAutoCategory, rerunRulesForAmount }
}
