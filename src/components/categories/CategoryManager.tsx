'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import type { Category, CategoryScope } from '@/types'

const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }

/* ── SVG helpers ─────────────────────────────────────────────────── */
function PencilIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={13} height={13}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
    </svg>
  )
}
function ChevronRightIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={13} height={13}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

/* ── Add form ────────────────────────────────────────────────────── */
interface AddFormState { name: string; icon: string; color: string; parentId: string }

function emptyAddForm(): AddFormState {
  return { name: '', icon: '📦', color: '#6B8F80', parentId: '' }
}

interface AddFormProps {
  form: AddFormState
  onChange: (f: AddFormState) => void
  onSave: () => void
  onCancel: () => void
  parentOptions: Category[]
}

function AddForm({ form, onChange, onSave, onCancel, parentOptions }: AddFormProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-accent/30 border-b border-border flex-shrink-0 flex-wrap">
      {/* Icon */}
      <input
        type="text" value={form.icon} maxLength={2}
        onChange={e => onChange({ ...form, icon: e.target.value })}
        className="w-9 h-8 text-center text-base border border-border rounded-lg bg-background text-foreground focus:outline-none focus:border-primary flex-shrink-0"
      />
      {/* Name */}
      <input
        type="text" value={form.name} autoFocus
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        placeholder="Kategori adı"
        className="flex-1 min-w-[120px] text-sm border border-border rounded-lg px-3 h-8 bg-background text-foreground focus:outline-none focus:border-primary"
      />
      {/* Parent dropdown */}
      {parentOptions.length > 0 && (
        <select
          value={form.parentId}
          onChange={e => onChange({ ...form, parentId: e.target.value })}
          className="text-xs border border-border rounded-lg px-2 h-8 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[160px]"
        >
          <option value="">Üst kategori yok</option>
          {parentOptions.map(p => (
            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
          ))}
        </select>
      )}
      {/* Color */}
      <label className="relative cursor-pointer flex-shrink-0" title="Renk seç">
        <div className="w-8 h-8 rounded-lg border border-border" style={{ background: form.color }} />
        <input type="color" value={form.color} onChange={e => onChange({ ...form, color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
      </label>
      {/* Save */}
      <button
        onClick={onSave} disabled={!form.name.trim()}
        className="px-3 h-8 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0"
      >
        Ekle
      </button>
      {/* Cancel */}
      <button
        onClick={onCancel}
        className="px-2.5 h-8 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
      >
        İptal
      </button>
    </div>
  )
}

/* ── Edit form row ───────────────────────────────────────────────── */
interface EditFormState { name: string; icon: string; color: string }

interface EditRowProps {
  form: EditFormState
  onChange: (f: EditFormState) => void
  onSave: () => void
  onCancel: () => void
  isChild: boolean
}

function EditRow({ form, onChange, onSave, onCancel, isChild }: EditRowProps) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 border-b border-border bg-accent/20 ${isChild ? 'pl-10' : ''}`}>
      <input type="text" value={form.icon} maxLength={2}
        onChange={e => onChange({ ...form, icon: e.target.value })}
        className="w-9 h-8 text-center text-base border border-border rounded-lg bg-background focus:outline-none focus:border-primary flex-shrink-0" />
      <input type="text" value={form.name} autoFocus
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        className="flex-1 text-sm border border-border rounded-lg px-3 h-8 bg-background focus:outline-none focus:border-primary" />
      <label className="relative cursor-pointer flex-shrink-0" title="Renk seç">
        <div className="w-8 h-8 rounded-lg border border-border" style={{ background: form.color }} />
        <input type="color" value={form.color} onChange={e => onChange({ ...form, color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
      </label>
      <button onClick={onSave} disabled={!form.name.trim()}
        className="px-3 h-8 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0">
        Kaydet
      </button>
      <button onClick={onCancel}
        className="px-2.5 h-8 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        İptal
      </button>
    </div>
  )
}

/* ── CategoryManager ─────────────────────────────────────────────── */

export function CategoryManager() {
  const router       = useRouter()
  const categories   = useCategoryStore(s => s.categories)
  const add          = useCategoryStore(s => s.add)
  const update       = useCategoryStore(s => s.update)
  const remove       = useCategoryStore(s => s.remove)
  const transactions = useTransactionStore(s => s.transactions)

  const [tab,             setTab]             = useState<CategoryScope>('expense')
  const [adding,          setAdding]          = useState(false)
  const [addForm,         setAddForm]         = useState<AddFormState>(emptyAddForm())
  const [editingId,       setEditingId]       = useState<string | null>(null)
  const [editForm,        setEditForm]        = useState<EditFormState>({ name: '', icon: '', color: '' })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const parents = useMemo(
    () => categories.filter(c => c.scope === tab && !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, tab],
  )

  const getChildren = (pid: string) =>
    categories.filter(c => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder)

  const txCount = (catId: string, withChildren: boolean) => {
    const childIds = withChildren ? categories.filter(c => c.parentId === catId).map(c => c.id) : []
    return transactions.filter(t =>
      t.categoryId === catId || (withChildren && childIds.includes(t.categoryId ?? '')),
    ).length
  }

  function startAdd() {
    setAdding(true)
    setAddForm(emptyAddForm())
    setEditingId(null)
    setConfirmDeleteId(null)
  }

  async function saveAdd() {
    if (!addForm.name.trim()) return
    const maxSort = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const cat: Category = {
      id:        crypto.randomUUID(),
      name:      addForm.name.trim(),
      icon:      addForm.icon || '📦',
      color:     addForm.color,
      scope:     tab,
      parentId:  addForm.parentId || undefined,
      isSystem:  false,
      sortOrder: maxSort + 1,
    }
    await add(cat)
    setAdding(false)
    setAddForm(emptyAddForm())
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditForm({ name: cat.name, icon: cat.icon, color: cat.color })
    setAdding(false)
    setConfirmDeleteId(null)
  }

  async function saveEdit() {
    if (!editingId) return
    await update(editingId, editForm)
    setEditingId(null)
  }

  async function handleDelete(cat: Category) {
    if (confirmDeleteId !== cat.id) { setConfirmDeleteId(cat.id); return }
    for (const sub of getChildren(cat.id)) await remove(sub.id)
    await remove(cat.id)
    setConfirmDeleteId(null)
  }

  function handleTabChange(s: CategoryScope) {
    setTab(s)
    setAdding(false)
    setEditingId(null)
    setConfirmDeleteId(null)
  }

  /* ── Row renderer ── */
  function renderRow(cat: Category, isChild: boolean) {
    if (editingId === cat.id) {
      return (
        <EditRow
          key={cat.id}
          form={editForm}
          onChange={setEditForm}
          onSave={saveEdit}
          onCancel={() => setEditingId(null)}
          isChild={isChild}
        />
      )
    }

    const count     = txCount(cat.id, !isChild)
    const isConfirm = confirmDeleteId === cat.id
    const children  = isChild ? [] : getChildren(cat.id)

    return (
      <div
        key={cat.id}
        className={[
          'group flex items-center gap-2.5 border-b border-border transition-colors cursor-pointer',
          isChild ? 'pl-10 pr-4 py-1.5 bg-muted/30 hover:bg-accent/40' : 'px-4 py-2 hover:bg-accent/40',
        ].join(' ')}
        onClick={() => !isConfirm && router.push(`/categories/${cat.id}`)}
      >
        {isChild && (
          <span className="text-muted-foreground/50 text-xs flex-shrink-0 -ml-1">↳</span>
        )}

        {/* Icon bubble */}
        <div
          className={`rounded-lg flex items-center justify-center flex-shrink-0 ${isChild ? 'w-6 h-6 text-xs' : 'w-7 h-7 text-sm'}`}
          style={{ background: `${cat.color}22` }}
        >
          {cat.icon}
        </div>

        {/* Name */}
        <span className={`flex-1 text-foreground truncate min-w-0 ${isChild ? 'text-[13px]' : 'text-sm font-medium'}`}>
          {cat.name}
        </span>

        {/* Children badge (root only) */}
        {!isChild && children.length > 0 && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            {children.length} alt
          </span>
        )}

        {/* Tx count */}
        {count > 0 && (
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            {count} işlem
          </span>
        )}

        {/* System badge */}
        {cat.isSystem && (
          <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 hidden group-hover:inline">
            sistem
          </span>
        )}

        {/* Actions */}
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => startEdit(cat)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Düzenle"
          >
            <PencilIcon />
          </button>

          {!cat.isSystem && (
            isConfirm ? (
              <>
                <button
                  onClick={() => handleDelete(cat)}
                  className="px-2 h-6 bg-destructive text-white text-[10px] font-semibold rounded-md"
                >
                  Sil
                </button>
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="w-6 h-6 flex items-center justify-center border border-border rounded-md text-muted-foreground text-xs hover:text-foreground transition-colors"
                >
                  ✕
                </button>
              </>
            ) : (
              <button
                onClick={() => handleDelete(cat)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors text-base leading-none"
                title="Sil"
              >
                ×
              </button>
            )
          )}
        </div>

        {/* Navigate chevron */}
        {!isConfirm && (
          <span className="text-muted-foreground/40 flex-shrink-0 group-hover:text-muted-foreground transition-colors">
            <ChevronRightIcon />
          </span>
        )}
      </div>
    )
  }

  const expenseCount = categories.filter(c => c.scope === 'expense' && !c.parentId).length
  const incomeCount  = categories.filter(c => c.scope === 'income'  && !c.parentId).length

  return (
    <div className="flex flex-col h-full">
      {/* ── Tabs + add button ── */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-border flex-shrink-0">
        {(['expense', 'income'] as CategoryScope[]).map(s => (
          <button
            key={s}
            onClick={() => handleTabChange(s)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            ].join(' ')}
          >
            {SCOPE_LABELS[s]}
            <span className={`text-[10px] tabular-nums ${tab === s ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
              {s === 'expense' ? expenseCount : incomeCount}
            </span>
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={startAdd}
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/85 transition-colors"
        >
          <span className="text-sm leading-none">+</span> Yeni Kategori
        </button>
      </div>

      {/* ── Add form ── */}
      {adding && (
        <AddForm
          form={addForm}
          onChange={setAddForm}
          onSave={saveAdd}
          onCancel={() => setAdding(false)}
          parentOptions={parents}
        />
      )}

      {/* ── Category list ── */}
      <div className="overflow-y-auto flex-1">
        {parents.map(parent => {
          const children = getChildren(parent.id)
          return (
            <div key={parent.id}>
              {renderRow(parent, false)}
              {children.map(child => renderRow(child, true))}
            </div>
          )
        })}

        {parents.length === 0 && !adding && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Bu kapsamda henüz kategori yok.
          </div>
        )}
      </div>
    </div>
  )
}
