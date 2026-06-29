'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import type { Category, CategoryScope } from '@/types'

const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }

/* ── Icons ───────────────────────────────────────────────────────── */
function PencilIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={12} height={12}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
    </svg>
  )
}
function ChevronRightIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={12} height={12}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  )
}

/* ── Form state ──────────────────────────────────────────────────── */
type FormState = { name: string; icon: string; color: string; parentId: string }
function emptyForm(): FormState { return { name: '', icon: '📦', color: '#6B8F80', parentId: '' } }

/* ── Inline form (add / edit) ────────────────────────────────────── */
interface InlineFormProps {
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onCancel: () => void
  label: string
  parentOptions: { id: string; label: string }[]
  indentPx: number
}

function InlineForm({ form, onChange, onSave, onCancel, label, parentOptions, indentPx }: InlineFormProps) {
  return (
    <div
      className="flex items-center gap-2 py-2 pr-4 bg-accent/25 border-b border-border flex-shrink-0 flex-wrap"
      style={{ paddingLeft: indentPx }}
    >
      <input
        type="text" value={form.icon} maxLength={2}
        onChange={e => onChange({ ...form, icon: e.target.value })}
        className="w-9 h-8 text-center text-base border border-border rounded-lg bg-background text-foreground focus:outline-none focus:border-primary flex-shrink-0"
      />
      <input
        type="text" value={form.name} autoFocus placeholder="Kategori adı"
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        className="flex-1 min-w-[120px] text-sm border border-border rounded-lg px-3 h-8 bg-background text-foreground focus:outline-none focus:border-primary"
      />
      {/* Parent dropdown */}
      <select
        value={form.parentId}
        onChange={e => onChange({ ...form, parentId: e.target.value })}
        className="text-xs border border-border rounded-lg px-2 h-8 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[180px]"
      >
        <option value="">Üst kategori yok (kök)</option>
        {parentOptions.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      {/* Color */}
      <label className="relative cursor-pointer flex-shrink-0" title="Renk seç">
        <div className="w-8 h-8 rounded-lg border border-border" style={{ background: form.color }} />
        <input type="color" value={form.color} onChange={e => onChange({ ...form, color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
      </label>
      <button onClick={onSave} disabled={!form.name.trim()}
        className="px-3 h-8 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0">
        {label}
      </button>
      <button onClick={onCancel}
        className="px-2.5 h-8 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        İptal
      </button>
    </div>
  )
}

/* ── Indent config ───────────────────────────────────────────────── */
const LEVEL_PX   = [16, 40, 60] as const  // paddingLeft per level
const LEVEL_ICON = ['w-7 h-7 text-sm', 'w-6 h-6 text-xs', 'w-5 h-5 text-[10px]'] as const
const LEVEL_BG   = ['', 'bg-muted/20', 'bg-muted/35'] as const
const LEVEL_TEXT = ['text-sm font-medium', 'text-[13px]', 'text-xs'] as const

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
  const [addForm,         setAddForm]         = useState<FormState>(emptyForm())
  const [editingId,       setEditingId]       = useState<string | null>(null)
  const [editForm,        setEditForm]        = useState<FormState>(emptyForm())
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* ── Helpers ── */
  const getChildren = useCallback(
    (pid: string) => categories.filter(c => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  const getLevel = useCallback((catId: string): 0 | 1 | 2 => {
    const cat = categories.find(c => c.id === catId)
    if (!cat?.parentId) return 0
    const parent = categories.find(c => c.id === cat.parentId)
    if (!parent?.parentId) return 1
    return 2
  }, [categories])

  const getAllDescendants = useCallback((catId: string): string[] => {
    const children = categories.filter(c => c.parentId === catId)
    return [catId, ...children.flatMap(c => getAllDescendants(c.id))]
  }, [categories])

  /* Transaction count for a category including all its descendants */
  const txCount = useCallback((catId: string) => {
    const ids = new Set(getAllDescendants(catId))
    return transactions.filter(t => t.categoryId && ids.has(t.categoryId)).length
  }, [transactions, getAllDescendants])

  /* Root categories for current tab */
  const roots = useMemo(
    () => categories.filter(c => c.scope === tab && !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, tab],
  )

  /* Valid parent options for add/edit (all non-leaf categories of same scope, excluding self & descendants) */
  function parentOptions(excludeId?: string): { id: string; label: string }[] {
    const excludeIds = new Set(excludeId ? getAllDescendants(excludeId) : [])
    return categories
      .filter(c =>
        c.scope === tab &&
        getLevel(c.id) < 2 &&          // only L1 and L2 can be parents
        !excludeIds.has(c.id),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => {
        const lvl = getLevel(c.id)
        const prefix = lvl === 1 ? '  ↳ ' : ''
        return { id: c.id, label: `${prefix}${c.icon} ${c.name}` }
      })
  }

  /* ── Handlers ── */
  function startAdd() {
    setAdding(true)
    setAddForm(emptyForm())
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
    setAddForm(emptyForm())
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditForm({ name: cat.name, icon: cat.icon, color: cat.color, parentId: cat.parentId ?? '' })
    setAdding(false)
    setConfirmDeleteId(null)
  }

  async function saveEdit() {
    if (!editingId || !editForm.name.trim()) return
    await update(editingId, {
      name:     editForm.name.trim(),
      icon:     editForm.icon || '📦',
      color:    editForm.color,
      parentId: editForm.parentId || undefined,
    })
    setEditingId(null)
  }

  async function handleDelete(cat: Category) {
    if (confirmDeleteId !== cat.id) { setConfirmDeleteId(cat.id); return }
    // Cascade: delete grandchildren → children → self
    const children = getChildren(cat.id)
    for (const child of children) {
      for (const gc of getChildren(child.id)) await remove(gc.id)
      await remove(child.id)
    }
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
  function renderRow(cat: Category, level: 0 | 1 | 2) {
    const pl      = LEVEL_PX[level]
    const isEdit  = editingId === cat.id
    const isConf  = confirmDeleteId === cat.id
    const count   = txCount(cat.id)
    const canHaveChildren = level < 2

    if (isEdit) {
      return (
        <InlineForm
          key={cat.id}
          form={editForm}
          onChange={setEditForm}
          onSave={saveEdit}
          onCancel={() => setEditingId(null)}
          label="Kaydet"
          parentOptions={parentOptions(cat.id)}
          indentPx={pl}
        />
      )
    }

    return (
      <div
        key={cat.id}
        className={[
          'group flex items-center gap-2 border-b border-border transition-colors cursor-pointer',
          LEVEL_BG[level],
          'hover:bg-accent/40',
        ].join(' ')}
        style={{ paddingLeft: pl, paddingRight: 16, paddingTop: level === 0 ? 8 : 5, paddingBottom: level === 0 ? 8 : 5 }}
        onClick={() => !isConf && router.push(`/categories/${cat.id}`)}
      >
        {level > 0 && (
          <span className="text-muted-foreground/40 text-[10px] flex-shrink-0 -ml-1 mr-0">↳</span>
        )}

        {/* Icon */}
        <div
          className={`${LEVEL_ICON[level]} rounded-lg flex items-center justify-center flex-shrink-0`}
          style={{ background: `${cat.color}22` }}
        >
          {cat.icon}
        </div>

        {/* Name */}
        <span className={`flex-1 text-foreground truncate min-w-0 ${LEVEL_TEXT[level]}`}>
          {cat.name}
        </span>

        {/* Child count badge (only if has children) */}
        {getChildren(cat.id).length > 0 && (
          <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
            {getChildren(cat.id).length} alt
          </span>
        )}

        {/* Tx count */}
        {count > 0 && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{count} işlem</span>
        )}

        {/* System badge */}
        {cat.isSystem && (
          <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 hidden group-hover:inline">sistem</span>
        )}

        {/* Actions */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          {/* Edit */}
          <button
            onClick={() => startEdit(cat)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Düzenle"
          >
            <PencilIcon />
          </button>

          {/* Add sub (max 3 levels) */}
          {canHaveChildren && (
            <button
              onClick={() => {
                setAdding(true)
                setAddForm({ ...emptyForm(), parentId: cat.id })
                setEditingId(null)
              }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors font-bold text-sm leading-none"
              title="Alt kategori ekle"
            >
              +
            </button>
          )}

          {/* Delete */}
          {!cat.isSystem && (
            isConf ? (
              <>
                <button onClick={() => handleDelete(cat)}
                  className="px-2 h-6 bg-destructive text-white text-[10px] font-semibold rounded-md">
                  Sil
                </button>
                <button onClick={() => setConfirmDeleteId(null)}
                  className="w-6 h-6 flex items-center justify-center border border-border rounded-md text-muted-foreground text-xs hover:text-foreground transition-colors">
                  ✕
                </button>
              </>
            ) : (
              <button onClick={() => handleDelete(cat)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors text-base leading-none"
                title="Sil">
                ×
              </button>
            )
          )}
        </div>

        {/* Navigate chevron */}
        {!isConf && (
          <span className="text-muted-foreground/30 flex-shrink-0 group-hover:text-muted-foreground/60 transition-colors">
            <ChevronRightIcon />
          </span>
        )}
      </div>
    )
  }

  /* ── 3-level recursive render ── */
  function renderTree(cats: Category[], level: 0 | 1 | 2) {
    return cats.map(cat => (
      <div key={cat.id}>
        {renderRow(cat, level)}
        {level < 2 && renderTree(getChildren(cat.id), (level + 1) as 1 | 2)}
      </div>
    ))
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
        <InlineForm
          form={addForm}
          onChange={setAddForm}
          onSave={saveAdd}
          onCancel={() => setAdding(false)}
          label="Ekle"
          parentOptions={parentOptions()}
          indentPx={16}
        />
      )}

      {/* ── Category tree ── */}
      <div className="overflow-y-auto flex-1">
        {renderTree(roots, 0)}

        {roots.length === 0 && !adding && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Bu kapsamda henüz kategori yok.
          </div>
        )}
      </div>
    </div>
  )
}
