'use client'

import { useMemo } from 'react'
import { X, Wallet, CreditCard, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { SelectField } from '@/components/ui/Select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { PersonSelect } from '@/components/people/PersonSelect'
import { TagInput } from '@/components/transactions/TagInput'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore } from '@/store'
import { useTags } from '@/lib/hooks/useTags'
import { recipientCategory } from '@/lib/auto-category'
import { suggestCategoryIcon } from '@/lib/category-icon-suggest'
import { SUBSCRIPTION_TAG, detectBrand, isSubscriptionTag } from '@/lib/subscriptions/brands'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { Category, Person } from '@/types'
import { optionDisplayOrder, type DraftTx, type PlanRow, type RowOption } from '@/lib/statement-import/classify'
import { recipientEdit, type RowEdit } from '@/lib/statement-import/commit'
import type { ParsedStatement } from '@/lib/statement-import/statement'
import { STATUS_META } from './PreviewList'

/* ── Ekstre satırının ayrıntısı ──────────────────────────────────────────────
   "İşlem Ekle" penceresiyle aynı düzen: ortada açılır, üstte tür sekmeleri
   (Gider / Gelir — satırın kararları izin veriyorsa), altında girilecek kayıt.
   Bankanın satırı ve kararın gerekçesi en altta, ikincil bilgi olarak durur. */

interface Props {
  row: PlanRow | null
  statement: ParsedStatement
  choice: number | null
  edit: RowEdit | undefined
  onChoose: (index: number) => void
  onEdit: (patch: RowEdit) => void
  onClose: () => void
}

/** Onayda oluşturulacak yeni alıcı, seçicide geçici bir kişi olarak gösterilir */
const PENDING_ID = '__new-recipient__'
const pendingPerson = (name: string): Person => ({ id: PENDING_ID, name, role: 'recipient', createdAt: '' })

const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type TxType = DraftTx['type']
const TYPE_LABEL: Record<TxType, string> = { expense: 'Gider', income: 'Gelir', transfer: 'Transfer' }

/** Seçeneğin gireceği kaydın türü (silme/atla gibi kayıt yazmayanlarda null) */
function optionType(o: RowOption): TxType | null {
  const creates = o.actions.filter(a => a.type === 'create')
  return creates.length && creates[0].type === 'create' ? creates[0].draft.type : null
}

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

export function RowModal({ row, statement, choice, edit, onChoose, onEdit, onClose }: Props) {
  const people       = usePeopleStore(s => s.people)
  const categories   = useCategoryStore(s => s.categories)
  const addCategory  = useCategoryStore(s => s.add)
  const accounts     = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)
  const allTags      = useTags()

  const expenseCats = useMemo(() => categories.filter(c => c.scope === 'expense' && !c.isArchived), [categories])
  const incomeCats  = useMemo(() => categories.filter(c => c.scope === 'income' && !c.isArchived), [categories])
  const recipients  = useMemo(() => people.filter(p => p.role === 'recipient' && !p.isArchived), [people])

  if (!row) return null

  // Düzenlenebilir taslak: seçili seçenekte TEK bir "oluştur" eylemi varsa
  const sel = choice ?? row.recommended
  const creates = sel !== null ? row.options[sel]?.actions.filter(a => a.type === 'create') ?? [] : []
  const draft: DraftTx | undefined = creates.length === 1 && creates[0].type === 'create' ? creates[0].draft : undefined
  const lines = row.lines.map(i => statement.lines[i])
  const meta = STATUS_META[row.status]

  // ── Tür sekmeleri: kararlar arasında hem gider hem gelir varsa (iade/alacak satırı)
  const order = optionDisplayOrder(row.options)
  const types = [...new Set(row.options.map(optionType).filter((t): t is TxType => t !== null))]
  const activeType: TxType | null = (sel !== null ? optionType(row.options[sel]) : null) ?? (types.length === 1 ? types[0] : null)
  const showTabs = types.length > 1
  const visibleOptions = order.filter(i => !showTabs || activeType === null || optionType(row.options[i]) === null || optionType(row.options[i]) === activeType)

  const tags = edit?.tags ?? draft?.tags ?? []
  const isSubscription = tags.some(isSubscriptionTag)

  function pickType(t: TxType) {
    if (t === activeType || !row) return
    const candidates = order.filter(i => optionType(row.options[i]) === t)
    const target = row.recommended !== null && candidates.includes(row.recommended) ? row.recommended : candidates[0]
    if (target === undefined) return
    onChoose(target)
    // Abonelik yalnız giderde anlamlı
    if (t !== 'expense' && isSubscription) onEdit({ tags: tags.filter(x => !isSubscriptionTag(x)) })
  }

  const newRecipientName = edit?.recipientId !== undefined ? undefined : (edit?.newRecipient ?? draft?.newRecipient)
  const recipientId = edit?.recipientId !== undefined ? edit.recipientId : (draft?.newRecipient ? null : draft?.recipientId)
  const categoryId = edit?.categoryId ?? draft?.categoryId ?? ''
  const description = edit?.description ?? draft?.description ?? row.title

  // ── Ödeme türü: tek çekim / taksitli (bankadan, kilitli) / abonelik
  const canPayType = !!draft && draft.editable && draft.type === 'expense' && draft.amount > 0
  const payType = draft?.installments ? 'installment' : isSubscription ? 'subscription' : 'one'
  const payTypes = ([
    { key: 'one',          label: 'Tek çekim', Icon: Wallet,     show: !draft?.installments },
    { key: 'installment',  label: 'Taksitli',  Icon: CreditCard, show: !!draft?.installments },
    { key: 'subscription', label: 'Abonelik',  Icon: Repeat,     show: !draft?.installments },
  ] as const).filter(o => o.show)
  const setSubscription = (on: boolean) => onEdit({
    tags: on ? (isSubscription ? tags : [...tags, SUBSCRIPTION_TAG]) : tags.filter(x => !isSubscriptionTag(x)),
  })
  const subBrand = isSubscription ? detectBrand(description, row.raw) : null

  async function createCategory(name: string): Promise<string> {
    const scope = draft?.type === 'income' ? 'income' : 'expense'
    const suggestion = suggestCategoryIcon(name, scope)
    const cat: Category = {
      id: crypto.randomUUID(), name, icon: suggestion.icon, color: suggestion.color, scope, isSystem: false,
      sortOrder: categories.reduce((m, c) => Math.max(m, c.sortOrder), 0) + 1,
    }
    await addCategory(cat)
    return cat.id
  }

  // Satırın karta etkisi (taksitte o ayın taksiti); alacak yeşil "+"
  const amount = row.amount
  const credit = (row.amount ?? 0) < 0

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-lg gap-0 p-0 overflow-hidden" showCloseButton={false} aria-describedby={undefined}>

        {/* ── Başlık + tür sekmeleri ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn('size-2 rounded-full', meta.dot)} />{meta.label}{row.issue ? ` · ${row.issue}` : ''}
              </div>
              <DialogTitle className="mt-1 truncate">{description}</DialogTitle>
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat"
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring">
              <X className="size-4" />
            </button>
          </div>
          {showTabs && (
            <div className={cn('mt-3 grid gap-1 rounded-lg bg-muted p-1', types.length === 3 ? 'grid-cols-3' : 'grid-cols-2')} role="tablist">
              {types.map(t => (
                <button key={t} type="button" role="tab" aria-selected={activeType === t} onClick={() => pickType(t)}
                  className={cn('rounded-md py-1.5 text-sm font-medium transition-all',
                    activeType === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="max-h-[min(70vh,640px)] overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {/* ── Tutar ── */}
          <div className="flex items-end justify-between gap-3">
            <div className="text-sm text-muted-foreground tabular-nums">{formatDate(row.date, 'd MMMM yyyy')}</div>
            {amount !== null && (
              <div className={cn('text-2xl font-semibold tabular-nums', credit && 'text-green-600')}>
                {credit ? '+' : '−'}{formatCurrency(Math.abs(amount))}
              </div>
            )}
          </div>

          {/* ── Karar ── */}
          {visibleOptions.length > 1 && (
            <div>
              <div className={cn(sectionLabel, 'mb-1.5')}>Karar</div>
              <div className="flex flex-col gap-1.5">
                {visibleOptions.map(i => {
                  const o = row.options[i]
                  return (
                    <label key={o.key} className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer',
                      choice === i ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                      <input type="radio" name={`opt-${row.key}`} checked={choice === i} onChange={() => onChoose(i)} className="accent-primary" />
                      <span className="flex-1">{o.label}</span>
                      {row.recommended === i && <span className="text-[10px] font-semibold text-primary">önerilen</span>}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Girilecek kayıt ── */}
          {draft && draft.editable && draft.type !== 'transfer' && (
            <div className="flex flex-col gap-4">
              {canPayType && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Ödeme türü</span>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                    {payTypes.map(({ key, label, Icon }) => (
                      <button key={key} type="button" disabled={key === 'installment'}
                        onClick={() => setSubscription(key === 'subscription')}
                        className={cn('flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-all',
                          payType === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                        <Icon className="size-3.5" />{label}
                      </button>
                    ))}
                  </div>
                  {payType === 'subscription' && (
                    <span className="text-[11px] text-muted-foreground">
                      {subBrand ? `${subBrand.name} olarak tanındı — ` : ''}Abonelikler sayfasında görünür; bu işyerinin sonraki satırları da abonelik olarak gelir.
                    </span>
                  )}
                  {payType === 'installment' && <span className="text-[11px] text-muted-foreground">Taksit bilgisi bankanın satırından gelir.</span>}
                </div>
              )}

              <Input label="Açıklama" value={description} onChange={e => onEdit({ description: e.target.value })} />

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Alıcı</span>
                {/* İşlem ekle formundaki seçiciyle aynı: aramada yoksa "… ekle". Yeni alıcı onayda oluşturulur. */}
                <PersonSelect
                  people={newRecipientName !== undefined ? [...recipients, pendingPerson(newRecipientName)] : recipients}
                  value={newRecipientName !== undefined ? PENDING_ID : (recipientId ?? undefined)}
                  onChange={id => {
                    if (id === PENDING_ID) return
                    onEdit(id ? recipientEdit(edit, id, rid => draft.type === 'transfer' ? undefined : recipientCategory(rid, draft.type, transactions, categories))
                      : { recipientId: null, newRecipient: undefined })
                  }}
                  onCreate={async name => { onEdit({ recipientId: undefined, newRecipient: name }); return PENDING_ID }}
                  placeholder="Alıcı seçin"
                />
                {newRecipientName !== undefined && <span className="text-[11px] text-muted-foreground">Yeni alıcı · onayda oluşturulur.</span>}
                {draft.needsRecipient && newRecipientName === undefined && !recipientId && <span className="text-[11px] text-destructive">Alıcı seçilmeden kayıt yapılmaz.</span>}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Kategori</span>
                <CategoryCascadeSelect categories={draft.type === 'income' ? incomeCats : expenseCats} value={categoryId} onChange={id => onEdit({ categoryId: id, categoryAuto: false })} error={!categoryId} onCreate={createCategory} />
                {!categoryId && <span className="text-[11px] text-destructive">Kategori seçilmeden kayıt yapılmaz.</span>}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Etiketler</span>
                <TagInput value={tags} onChange={next => onEdit({ tags: next })} tags={allTags} />
              </div>

              {draft.installments && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Oluşturulacak taksitler</div>
                  <div className="rounded-xl border border-border divide-y divide-border/60 text-sm tabular-nums">
                    {draft.installments.amounts.map((a, i) => (
                      <div key={i} className="flex justify-between px-3 py-1.5">
                        <span>{i + 1}. taksit · {formatDate(draft.installments!.dates[i], 'd MMM yyyy')}</span>
                        <span>{formatCurrency(Math.abs(a))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {draft?.type === 'transfer' && !draft.toAccountId && (
            <SelectField
              label={statement.type === 'checking' ? 'Paranın geldiği hesap' : 'Ödemenin yapıldığı hesap'}
              value={edit?.fromAccountId ?? draft.fromAccountId ?? ''}
              onChange={e => onEdit({ fromAccountId: e.target.value })}
              options={accounts.filter(a => !a.isArchived && a.type !== 'credit_card').map(a => ({ value: a.id, label: a.name }))}
            />
          )}
          {draft?.type === 'transfer' && draft.toAccountId && (
            <SelectField
              label="Paranın gittiği hesap"
              value={edit?.toAccountId ?? draft.toAccountId}
              onChange={e => onEdit({ toAccountId: e.target.value })}
              options={accounts.filter(a => !a.isArchived).map(a => ({ value: a.id, label: a.name }))}
            />
          )}

          {/* ── İkincil: neden, bankadaki satır, sistemdeki karşılığı ── */}
          <div className="flex flex-col gap-3 rounded-xl bg-muted/40 px-3.5 py-3">
            <div>
              <div className={cn(sectionLabel, 'mb-1')}>Neden bu karar</div>
              <div className="text-sm leading-relaxed">
                {row.reason}
                {row.note && <div className="mt-1.5 text-amber-600 text-xs">{row.note}</div>}
              </div>
            </div>
            {row.match && (
              <div>
                <div className={cn(sectionLabel, 'mb-1')}>Sistemdeki karşılığı</div>
                <div className="text-sm">{row.match.text}</div>
              </div>
            )}
            {lines.length > 0 && (
              <div>
                <div className={cn(sectionLabel, 'mb-1')}>Bankadaki satır{lines.length > 1 ? 'lar' : ''}</div>
                {lines.map(l => (
                  <div key={l.index} className="font-mono text-[11px] text-muted-foreground flex justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {l.date ? formatDate(l.date, 'd MMM yyyy') : 'tarihsiz'} · {l.description}
                      {l.bankCategory && ` · ${l.bankCategory}`}
                      {l.installment && ` · ${fmt(l.installment.total)} ₺ ${l.installment.index}/${l.installment.count}. taksit`}
                      {l.foreign && ` · ${fmt(l.foreign.amount)} ${l.foreign.currency}`}
                      {l.bonus !== null && ` · bonus ${fmt(l.bonus)}`}
                    </span>
                    <span className="tabular-nums whitespace-nowrap">{l.amount === null ? '—' : `${l.amount < 0 ? '+' : ''}${fmt(Math.abs(l.amount))}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button onClick={onClose}>Tamam</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
