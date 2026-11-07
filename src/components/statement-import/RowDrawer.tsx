'use client'

import { useEffect, useMemo } from 'react'
import { IconX } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { SelectField } from '@/components/ui/Select'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { PersonSelect } from '@/components/people/PersonSelect'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore } from '@/store'
import { recipientCategory } from '@/lib/auto-category'
import { suggestCategoryIcon } from '@/lib/category-icon-suggest'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { Category, Person } from '@/types'
import { optionDisplayOrder, type DraftTx, type PlanRow } from '@/lib/statement-import/classify'
import { recipientEdit, type RowEdit } from '@/lib/statement-import/commit'
import type { ParsedStatement } from '@/lib/statement-import/statement'
import { STATUS_META } from './PreviewList'

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

export function RowDrawer({ row, statement, choice, edit, onChoose, onEdit, onClose }: Props) {
  const people     = usePeopleStore(s => s.people)
  const categories = useCategoryStore(s => s.categories)
  const addCategory = useCategoryStore(s => s.add)
  const accounts   = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)

  useEffect(() => {
    if (!row) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  const expenseCats = useMemo(() => categories.filter(c => c.scope === 'expense' && !c.isArchived), [categories])
  const incomeCats = useMemo(() => categories.filter(c => c.scope === 'income' && !c.isArchived), [categories])
  const recipients = useMemo(() => people.filter(p => p.role === 'recipient' && !p.isArchived), [people])

  if (!row) return null

  // Düzenlenebilir taslak: seçili seçenekte TEK bir "oluştur" eylemi varsa
  const sel = choice ?? row.recommended
  const creates = sel !== null ? row.options[sel]?.actions.filter(a => a.type === 'create') ?? [] : []
  const draft: DraftTx | undefined = creates.length === 1 && creates[0].type === 'create' ? creates[0].draft : undefined
  const lines = row.lines.map(i => statement.lines[i])
  const meta = STATUS_META[row.status]

  const newRecipientName = edit?.recipientId !== undefined ? undefined : (edit?.newRecipient ?? draft?.newRecipient)
  const recipientId = edit?.recipientId !== undefined ? edit.recipientId : (draft?.newRecipient ? null : draft?.recipientId)
  const categoryId = edit?.categoryId ?? draft?.categoryId ?? ''

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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 h-full w-full sm:w-[420px] bg-background border-l border-border flex flex-col" aria-label="Satır ayrıntısı">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className={cn('size-2 rounded-full', meta.dot)} />{meta.label}
            </div>
            <div className="text-base font-semibold mt-1 break-words">{edit?.description ?? row.title}</div>
            <div className="text-xs text-muted-foreground tabular-nums">{formatDate(row.date)}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {row.amount !== null && (
              <div className={cn('text-base font-semibold tabular-nums', row.amount < 0 && 'text-green-600')}>
                {row.amount < 0 ? '+' : row.amount > 0 ? '−' : ''}{formatCurrency(Math.abs(row.amount))}
              </div>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Kapat"><IconX className="size-4" /></Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {lines.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Bankadaki satır{lines.length > 1 ? 'lar' : ''}</div>
              <div className="rounded-xl border border-border divide-y divide-border/60">
                {lines.map(l => (
                  <div key={l.index} className="px-3 py-2 font-mono text-[11px] text-muted-foreground flex justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {l.date ? formatDate(l.date, 'd MMM yyyy') : 'tarihsiz'} · {l.description}
                      {l.installment && ` · ${fmt(l.installment.total)} ₺ ${l.installment.index}/${l.installment.count}. taksit`}
                      {l.foreign && ` · ${fmt(l.foreign.amount)} ${l.foreign.currency}`}
                      {l.bonus !== null && ` · bonus ${fmt(l.bonus)}`}
                    </span>
                    <span className="tabular-nums whitespace-nowrap">{l.amount === null ? '—' : `${l.amount < 0 ? '+' : ''}${fmt(Math.abs(l.amount))}`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Neden bu karar</div>
            <div className="rounded-xl border border-border px-3 py-2.5 text-sm leading-relaxed">
              {row.reason}
              {row.note && <div className="mt-2 text-amber-600 text-xs">{row.note}</div>}
            </div>
          </div>

          {row.match && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Sistemdeki karşılığı</div>
              <div className="rounded-xl border border-border px-3 py-2.5 text-sm">{row.match.text}</div>
            </div>
          )}

          {row.options.length > 1 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Karar</div>
              <div className="flex flex-col gap-1.5">
                {optionDisplayOrder(row.options).map(i => ({ o: row.options[i], i })).map(({ o, i }) => (
                  <label key={o.key} className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer',
                    choice === i ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40')}>
                    <input type="radio" name={`opt-${row.key}`} checked={choice === i} onChange={() => onChoose(i)} className="accent-primary" />
                    <span className="flex-1">{o.label}</span>
                    {row.recommended === i && <span className="text-[10px] font-semibold text-primary">önerilen</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {draft && draft.editable && draft.type !== 'transfer' && (
            <div className="flex flex-col gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Girilecek kayıt</div>
              <Input label="Açıklama" value={edit?.description ?? draft.description} onChange={e => onEdit({ description: e.target.value })} />
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
        </div>
      </aside>
    </>
  )
}
