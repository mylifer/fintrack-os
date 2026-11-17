'use client'

import { useMemo, useState } from 'react'
import { X, Wallet, CreditCard, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { DateStepperInput } from '@/components/ui/DateStepperInput'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { PersonSelect } from '@/components/people/PersonSelect'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { TagInput } from '@/components/transactions/TagInput'
import { Field, AppSelect, PersonField } from '@/components/transactions/form/fields'
import { DescriptionAutocomplete } from '@/components/transactions/form/DescriptionAutocomplete'
import { TABS, buildSuggestions, type Suggestion } from '@/components/transactions/form/form-model'
import { useSelectOpenGuard } from '@/components/transactions/form/useSelectOpenGuard'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore } from '@/store'
import { useTags } from '@/lib/hooks/useTags'
import { recipientCategory } from '@/lib/auto-category'
import { suggestCategoryIcon } from '@/lib/category-icon-suggest'
import { SUBSCRIPTION_TAG, detectBrand, isSubscriptionTag } from '@/lib/subscriptions/brands'
import { dedupeTags } from '@/lib/utils/tags'
import { cn } from '@/lib/utils'
import { parseAmount } from '@/lib/utils/csv'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { Category, Person } from '@/types'
import { optionDisplayOrder, type DraftTx, type PlanRow, type RowOption } from '@/lib/statement-import/classify'
import { recipientEdit, type RowEdit } from '@/lib/statement-import/commit'
import { MANUAL_KEYS } from '@/lib/statement-import/manual-options'
import type { ParsedStatement } from '@/lib/statement-import/statement'
import { STATUS_META } from './PreviewList'
import { RefundLinkPicker, refundLinkable } from './RefundLinkPicker'
import { TransferSourceSelect, TransferTargetFields } from './ManualTransferFields'

/* ── Ekstre satırının ayrıntısı ──────────────────────────────────────────────
   İşlem Ekle penceresiyle BİREBİR aynı düzen: üstte Gider / Gelir / Transfer
   sekmeleri, büyük tutar, sonra Açıklama · Hesap + Kategori/Hedef · Tarih ·
   Ödeme türü · Aile üyesi + Alıcı · Not · Etiketler. Farkları: tutar bankanın
   satırından gelir (değiştirilemez) ve ekstrenin hesabı sabittir. Sekme, satırın
   kararlarından o türdekini seçer (yoksa sekme kapalıdır). Ekstreye özgü bilgi
   — kararın seçenekleri, gerekçesi, bankadaki satır, sistemdeki karşılığı — en
   altta "Ek bilgi" bölümündedir. */

interface Props {
  row: PlanRow | null
  statement: ParsedStatement
  /** Ekstrenin yüklendiği hesap */
  accountId: string
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

/** Seçeneğin gireceği kaydın türü (silme/atla gibi kayıt yazmayanlarda null) */
function optionType(o: RowOption): TxType | null {
  const creates = o.actions.filter(a => a.type === 'create')
  return creates.length && creates[0].type === 'create' ? creates[0].draft.type : null
}

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

/** Tutarın elle düzeltilmesi: yazarken serbest metin, odaktan çıkınca okunur */
function AmountEdit({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmt(value))
  const commit = () => {
    const v = parseAmount(text)
    if (v !== null && Math.abs(v) > 0) { onChange(Math.round(Math.abs(v) * 100) / 100); setText(fmt(Math.abs(v))) }
    else setText(fmt(value))
  }
  return (
    <input
      aria-label="Tutar" inputMode="decimal" value={text}
      onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-56 bg-transparent text-center text-5xl font-bold tabular-nums leading-none outline-none rounded-md focus:ring-2 focus:ring-ring"
    />
  )
}

export function RowModal({ row, statement, accountId, choice, edit, onChoose, onEdit, onClose }: Props) {
  const people       = usePeopleStore(s => s.people)
  const categories   = useCategoryStore(s => s.categories)
  const addCategory  = useCategoryStore(s => s.add)
  const accounts     = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)
  const allTags      = useTags()
  const { selectWasOpenRef, onSelectOpen } = useSelectOpenGuard()

  const expenseCats = useMemo(() => categories.filter(c => c.scope === 'expense' && !c.isArchived), [categories])
  const incomeCats  = useMemo(() => categories.filter(c => c.scope === 'income' && !c.isArchived), [categories])
  const recipients  = useMemo(() => people.filter(p => p.role === 'recipient' && !p.isArchived), [people])

  const sel = row ? choice ?? row.recommended : null
  const selOpt = row && sel !== null ? row.options[sel] : undefined
  const activeTypeRaw: TxType | null = selOpt ? optionType(selOpt) : null
  const suggestions = useMemo<Suggestion[]>(
    () => buildSuggestions(transactions, activeTypeRaw ?? 'expense', accounts),
    [transactions, activeTypeRaw, accounts],
  )

  if (!row) return null

  // Düzenlenebilir taslak: seçili seçenekte TEK bir "oluştur" eylemi varsa
  const creates = selOpt?.actions.filter(a => a.type === 'create') ?? []
  const draft: DraftTx | undefined = creates.length === 1 && creates[0].type === 'create' ? creates[0].draft : undefined
  const lines = row.lines.map(i => statement.lines[i])
  const meta = STATUS_META[row.status]
  const account = accounts.find(a => a.id === accountId)

  // ── Sekmeler: İşlem Ekle'deki üç tür; satırın o türde kararı yoksa kapalı
  const order = optionDisplayOrder(row.options)
  const typesAvailable = new Set(row.options.map(optionType).filter((t): t is TxType => t !== null))
  const activeType = activeTypeRaw
  const visibleOptions = order.filter(i => activeType === null || optionType(row.options[i]) === null || optionType(row.options[i]) === activeType)

  const tags = edit?.tags ?? draft?.tags ?? []
  const isSubscription = tags.some(isSubscriptionTag)
  const outflow = (row.amount ?? 0) > 0

  function pickType(t: TxType) {
    if (t === activeType || !row) return
    const candidates = order.filter(i => optionType(row.options[i]) === t)
    const target = row.recommended !== null && candidates.includes(row.recommended) ? row.recommended : candidates[0]
    if (target === undefined) return
    onChoose(target)
    // Abonelik yalnız giderde anlamlı
    if (t !== 'expense' && isSubscription) onEdit({ tags: tags.filter(x => !isSubscriptionTag(x)) })
  }

  const useManualTransfer = () => {
    const i = row.options.findIndex(o => o.key === MANUAL_KEYS.transfer)
    if (i >= 0) onChoose(i)
  }

  const editable = !!draft?.editable && draft.type !== 'transfer'
  const newRecipientName = edit?.recipientId !== undefined ? undefined : (edit?.newRecipient ?? draft?.newRecipient)
  const recipientId = edit?.recipientId !== undefined ? edit.recipientId : (draft?.newRecipient ? null : draft?.recipientId)
  const categoryId = edit?.categoryId ?? draft?.categoryId ?? ''
  const description = edit?.description ?? draft?.description ?? row.title
  const date = edit?.date ?? draft?.date ?? row.date
  const dateLocked = !!draft?.installments || !!draft?.installmentOf
  const familyMemberId = edit?.familyMemberId !== undefined ? edit.familyMemberId : draft?.familyMemberId

  /** Yeni alıcının adı yazıldı/düzeltildi. Açıklama alıcı adının kendisiyse
   *  (elle değiştirilmediyse) o da yeni adı izler. */
  function setNewRecipient(name: string) {
    const followsName = newRecipientName !== undefined && description === newRecipientName
    onEdit({ recipientId: undefined, newRecipient: name, ...(followsName && name.trim() ? { description: name } : {}) })
  }

  /** Açıklama önerisi seçildi: İşlem Ekle'deki gibi geçmiş kaydın kategori,
   *  kişi ve etiketleri gelir (transferde hedef hesap). */
  function pickSuggestion(s: Suggestion) {
    const patch: RowEdit = { description: s.description }
    if (editable) {
      if (s.categoryId) { patch.categoryId = s.categoryId; patch.categoryAuto = false }
      if (s.recipientId) { patch.recipientId = s.recipientId; patch.newRecipient = undefined }
      if (s.familyMemberId) patch.familyMemberId = s.familyMemberId
    }
    if (s.tags?.length) patch.tags = dedupeTags([...tags, ...s.tags])
    if (draft?.type === 'transfer' && outflow && s.toAccountId && s.toAccountId !== accountId
      && (!draft.manual || (edit?.transferMode ?? draft.transferMode) === 'account')) patch.toAccountId = s.toAccountId
    onEdit(patch)
  }

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

  // Tutar hero'su: İşlem Ekle'deki işaretler (gider −, iade/gelir +, transfer işaretsiz)
  // Tutar: kararın taslağındaki (ör. "Tek iade olarak gir": toplam), elle
  // düzeltildiyse o. Taksit grubunda düzenlenmez (taksitler bankanın bölüşümüyle).
  const amountEditable = !!draft && !draft.installments && !draft.installmentOf
  const absAmount = edit?.amount ?? Math.abs(draft?.amount ?? row.amount ?? 0)
  const bankAbs = Math.abs(row.amount ?? 0)
  const heroType: TxType = activeType ?? (outflow ? 'expense' : 'income')
  const refund = heroType === 'expense' && (draft ? draft.amount < 0 : !outflow)
  const sign = heroType === 'transfer' ? '' : heroType === 'income' || refund ? '+' : '−'

  const lockedAccount = account ? [{ value: account.id, label: account.name, icon: <AccountAvatar account={account} size="xs" /> }] : []

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        className="sm:max-w-lg gap-0 p-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
        onInteractOutside={e => { if (selectWasOpenRef.current) { selectWasOpenRef.current = false; e.preventDefault() } }}
      >

        {/* ── Başlık + tür sekmeleri ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn('size-2 rounded-full', meta.dot)} />{meta.label}{row.issue ? ` · ${row.issue}` : ''}
              </div>
              <DialogTitle className="mt-1 truncate">{row.status === 'exists' ? 'Sistemdeki Kayıt' : 'İşlem Ekle'}</DialogTitle>
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat"
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring">
              <X className="size-4" />
            </button>
          </div>
          {typesAvailable.size > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="tablist">
              {TABS.map(({ key, label }) => {
                const enabled = typesAvailable.has(key)
                return (
                  <button key={key} type="button" role="tab" aria-selected={activeType === key} disabled={!enabled}
                    title={enabled ? undefined : key === 'income' ? 'Hesaptan çıkan para gelir olarak girilemez' : 'Bu satır bu türde girilemez'}
                    onClick={() => pickType(key)}
                    className={cn('rounded-md py-1.5 text-sm font-medium transition-all',
                      activeType === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      !enabled && 'opacity-40 cursor-not-allowed hover:text-muted-foreground')}>
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </DialogHeader>

        {/* ── Tutar (bankanın satırından) ── */}
        {row.amount !== null && (
          <div className="relative h-24 flex flex-col items-center justify-center border-b bg-muted/50 select-none">
            <div className="flex items-center gap-2">
              {sign && <span className={cn('text-2xl font-semibold leading-none', sign === '+' ? 'text-green-600' : 'text-muted-foreground/50')}>{sign}</span>}
              <span className="text-2xl font-semibold leading-none text-muted-foreground/50">₺</span>
              {amountEditable
                ? <AmountEdit key={`${row.key}:${selOpt?.key}`} value={absAmount} onChange={v => onEdit({ amount: v })} />
                : <span className="text-5xl font-bold tabular-nums leading-none">{fmt(absAmount)}</span>}
            </div>
            <span className="absolute bottom-1.5 text-[10px] text-muted-foreground">
              {Math.round(absAmount * 100) === Math.round(bankAbs * 100)
                ? (amountEditable ? 'Bankanın tutarı · düzeltmek için tıklayın' : 'Tutar bankanın satırından gelir')
                : <>Bankada {fmt(bankAbs)} ₺{edit?.amount !== undefined && <> · <button type="button" className="text-primary hover:underline" onClick={() => onEdit({ amount: undefined })}>geri al</button></>}</>}
            </span>
          </div>
        )}

        <div className="max-h-[min(62vh,620px)] overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {!draft && row.status !== 'exists' && (
            <div className="rounded-xl border border-dashed px-3.5 py-3 text-sm text-muted-foreground">
              {selOpt ? 'Bu karar kayıt girmiyor.' : 'Bu satırın nasıl girileceğini seç:'} Yukarıdan bir tür seçebilir ya da aşağıdaki Ek bilgi bölümünden kararı değiştirebilirsin.
            </div>
          )}

          {draft && (
            <>
              {/* Açıklama */}
              <Field label="Açıklama" error={!description.trim() ? 'Açıklama girin' : undefined}>
                <DescriptionAutocomplete
                  autoFocus={false}
                  value={description}
                  onChange={v => onEdit({ description: v })}
                  onSelect={pickSuggestion}
                  suggestions={suggestions}
                  categories={categories}
                  people={people}
                  accounts={accounts}
                />
              </Field>

              {/* Hesap + Kategori / Hedef */}
              <div className="grid grid-cols-2 gap-3">
                {draft.type === 'transfer' && !outflow ? (
                  <>
                    <Field label="Hesap"><TransferSourceSelect draft={draft} edit={edit} accountId={accountId} onEdit={onEdit} onOpenChange={onSelectOpen} /></Field>
                    <Field label="Hedef Hesap"><AppSelect value={accountId} onChange={() => {}} options={lockedAccount} disabled /></Field>
                  </>
                ) : (
                  <>
                    <Field label="Hesap"><AppSelect value={accountId} onChange={() => {}} options={lockedAccount} disabled /></Field>
                    {draft.type === 'transfer' ? (
                      <TransferTargetFields draft={draft} edit={edit} accountId={accountId} outgoing onEdit={onEdit}
                        onUseManual={useManualTransfer} onOpenChange={onSelectOpen} />
                    ) : (
                      <Field label="Kategori" error={editable && !categoryId ? 'Kategori seçin' : undefined}>
                        {editable
                          ? <CategoryCascadeSelect categories={draft.type === 'income' ? incomeCats : expenseCats} value={categoryId}
                              onChange={id => onEdit({ categoryId: id, categoryAuto: false })} error={!categoryId} onCreate={createCategory} />
                          : <AppSelect value={categoryId} onChange={() => {}} disabled
                              options={categories.filter(c => c.id === categoryId).map(c => ({ value: c.id, label: c.name }))} placeholder="—" />}
                      </Field>
                    )}
                  </>
                )}
              </div>

              {/* Tarih */}
              <Field label="Tarih">
                {dateLocked
                  ? <AppSelect value={date} onChange={() => {}} disabled options={[{ value: date, label: formatDate(date, 'd MMMM yyyy') }]} />
                  : <DateStepperInput value={date} onValueChange={d => onEdit({ date: d })} />}
                {date !== row.date && <span className="text-[11px] text-muted-foreground">Bankadaki tarih: {formatDate(row.date, 'd MMMM yyyy')}</span>}
              </Field>

              {/* Ödeme türü */}
              {canPayType && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Ödeme türü</span>
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

              {draft.installments && (
                <div>
                  <div className="text-sm font-medium mb-1.5">Oluşturulacak taksitler</div>
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

              {/* Kişiler — İşlem Ekle'deki gibi transferde yok */}
              {draft.type !== 'transfer' && (
                <div className="grid grid-cols-2 gap-3">
                  {editable
                    ? <PersonField role="family_member" value={familyMemberId} onChange={id => onEdit({ familyMemberId: id ?? null })} />
                    : <Field label="Aile Üyesi" optional><AppSelect value="" onChange={() => {}} disabled options={[]} placeholder="—" /></Field>}
                  <Field label="Alıcı" optional={!draft.needsRecipient}
                    error={draft.needsRecipient && newRecipientName === undefined && !recipientId ? 'Alıcı seçin' : undefined}>
                    {/* Aramada yoksa "… ekle": yeni alıcı onayda oluşturulur */}
                    <PersonSelect
                      people={newRecipientName !== undefined ? [...recipients, pendingPerson(newRecipientName)] : recipients}
                      value={newRecipientName !== undefined ? PENDING_ID : (recipientId ?? undefined)}
                      onChange={id => {
                        if (!editable || id === PENDING_ID) return
                        onEdit(id ? recipientEdit(edit, id, rid => draft.type === 'transfer' ? undefined : recipientCategory(rid, draft.type, transactions, categories))
                          : { recipientId: null, newRecipient: undefined })
                      }}
                      onCreate={editable ? async name => { setNewRecipient(name); return PENDING_ID } : undefined}
                      createAlongsideResults
                      placeholder="Alıcı seçin"
                    />
                    {newRecipientName !== undefined && editable && (
                      <input
                        aria-label="Yeni alıcının adı"
                        value={newRecipientName}
                        onChange={e => setNewRecipient(e.target.value)}
                        placeholder="Yeni alıcının adı"
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      />
                    )}
                  </Field>
                </div>
              )}

              {/* Not */}
              <Field label="Not" optional>
                <Input value={edit?.notes ?? draft.notes ?? ''} onChange={e => onEdit({ notes: e.target.value })} placeholder="Ek bilgi..." />
              </Field>

              {/* Etiketler */}
              <Field label="Etiketler" optional>
                <TagInput value={tags} onChange={next => onEdit({ tags: next })} tags={allTags} />
              </Field>
            </>
          )}

          {/* ── Ek bilgi: ekstreye özgü ── */}
          <div className="flex flex-col gap-3 rounded-xl bg-muted/40 px-3.5 py-3">
            <div className={sectionLabel}>Ek bilgi</div>
            {visibleOptions.length > 1 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Karar</div>
                <div className="flex flex-col gap-1.5">
                  {visibleOptions.map(i => {
                    const o = row.options[i]
                    return (
                      <label key={o.key} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-sm cursor-pointer bg-background',
                        sel === i ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                        <input type="radio" name={`opt-${row.key}`} checked={sel === i} onChange={() => onChoose(i)} className="accent-primary" />
                        <span className="flex-1">{o.label}</span>
                        {row.recommended === i && <span className="text-[10px] font-semibold text-primary">önerilen</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* İade: hangi alımın iadesi? */}
            {refundLinkable(row, selOpt) && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Hangi alımın iadesi?</div>
                <RefundLinkPicker row={row} stacked onPick={onEdit} required={selOpt?.key === 'link'}
                  selectedId={edit?.refundOfId !== undefined ? (edit.refundOfId ?? undefined) : draft?.refundOfId} />
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Neden bu karar</div>
              <div className="text-sm leading-relaxed">
                {row.reason}
                {row.note && <div className="mt-1.5 text-amber-600 text-xs">{row.note}</div>}
              </div>
            </div>
            {row.match && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Sistemdeki karşılığı</div>
                <div className="text-sm whitespace-pre-line">{row.match.text}</div>
              </div>
            )}
            {lines.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Bankadaki satır{lines.length > 1 ? 'lar' : ''}</div>
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
