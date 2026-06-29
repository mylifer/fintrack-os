'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import { CategoryIcon } from './CategoryIcon'
import { CategoryIconPicker } from './CategoryIconPicker'
import type { Category, CategoryScope } from '@/types'

const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }

/* ── Form state ──────────────────────────────────────────────────── */
type FormState = { name: string; icon: string; color: string; parentId: string }
function emptyForm(): FormState { return { name: '', icon: 'ShoppingCart', color: '#6B8F80', parentId: '' } }

/* ── Inline form ─────────────────────────────────────────────────── */
interface InlineFormProps {
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onCancel: () => void
  label: string
  parentOptions: { id: string; label: string }[]
  indentPx?: number
}

function InlineForm({ form, onChange, onSave, onCancel, label, parentOptions, indentPx = 16 }: InlineFormProps) {
  return (
    <div
      className="flex items-center gap-2 py-2 pr-4 bg-accent/25 border-b border-border flex-wrap"
      style={{ paddingLeft: indentPx }}
    >
      {/* Icon picker */}
      <CategoryIconPicker
        value={form.icon}
        color={form.color}
        onChange={icon => onChange({ ...form, icon })}
      />

      {/* Name */}
      <input
        type="text" value={form.name} autoFocus placeholder="Kategori adı"
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        className="flex-1 min-w-[120px] text-sm border border-border rounded-lg px-3 h-9 bg-background text-foreground focus:outline-none focus:border-primary"
      />

      {/* Parent dropdown */}
      <select
        value={form.parentId}
        onChange={e => onChange({ ...form, parentId: e.target.value })}
        className="text-xs border border-border rounded-lg px-2 h-9 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[180px]"
      >
        <option value="">Kök (üst yok)</option>
        {parentOptions.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>

      {/* Color */}
      <label className="relative cursor-pointer flex-shrink-0" title="Renk seç">
        <div className="w-9 h-9 rounded-xl border-2 border-border" style={{ background: form.color }} />
        <input type="color" value={form.color} onChange={e => onChange({ ...form, color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
      </label>

      <button onClick={onSave} disabled={!form.name.trim()}
        className="px-3 h-9 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0">
        {label}
      </button>
      <button onClick={onCancel}
        className="px-2.5 h-9 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        İptal
      </button>
    </div>
  )
}

/* ── Indent config ───────────────────────────────────────────────── */
const LEVEL_PL   = [16, 40, 60] as const
const LEVEL_BG   = ['', 'bg-muted/20', 'bg-muted/35'] as const
const LEVEL_TEXT = ['text-sm font-medium', 'text-[13px]', 'text-xs'] as const
const ICON_SIZE  = [18, 15, 13] as const

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

  /* ── Tree helpers ── */
  const getChildren = useCallback(
    (pid: string) => categories.filter(c => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  const getLevel = useCallback((catId: string): 0 | 1 | 2 => {
    const cat = categories.find(c => c.id === catId)
    if (!cat?.parentId) return 0
    const par = categories.find(c => c.id === cat.parentId)
    if (!par?.parentId) return 1
    return 2
  }, [categories])

  const getAllDescendants = useCallback((catId: string): string[] => {
    const ch = categories.filter(c => c.parentId === catId)
    return [catId, ...ch.flatMap(c => getAllDescendants(c.id))]
  }, [categories])

  /* Transaction count including all descendants */
  const txCount = useCallback((catId: string) => {
    const ids = new Set(getAllDescendants(catId))
    return transactions.filter(t => t.categoryId && ids.has(t.categoryId)).length
  }, [transactions, getAllDescendants])

  const roots = useMemo(
    () => categories.filter(c => c.scope === tab && !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, tab],
  )

  /* Valid parents: L0 and L1 of same scope, excluding self+descendants */
  function buildParentOptions(excludeId?: string): { id: string; label: string }[] {
    const excluded = new Set(excludeId ? getAllDescendants(excludeId) : [])
    return categories
      .filter(c => c.scope === tab && getLevel(c.id) < 2 && !excluded.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => {
        const lvl    = getLevel(c.id)
        const indent = lvl === 1 ? '  ↳ ' : ''
        return { id: c.id, label: `${indent}${c.name}` }
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
      icon:      addForm.icon || 'Package',
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
      icon:     editForm.icon || 'Package',
      color:    editForm.color,
      parentId: editForm.parentId || undefined,
    })
    setEditingId(null)
  }

  async function handleDelete(cat: Category) {
    if (confirmDeleteId !== cat.id) { setConfirmDeleteId(cat.id); return }
    const children = getChildren(cat.id)
    for (const child of children) {
      for (const gc of getChildren(child.id)) await remove(gc.id)
      await remove(child.id)
    }
    await remove(cat.id)
    setConfirmDeleteId(null)
  }

  function handleTabChange(s: CategoryScope) {
    setTab(s); setAdding(false); setEditingId(null); setConfirmDeleteId(null)
  }

  /* ── Row renderer ── */
  function renderRow(cat: Category, level: 0 | 1 | 2) {
    const isEdit = editingId === cat.id
    const isConf = confirmDeleteId === cat.id
    const count  = txCount(cat.id)
    const pl     = LEVEL_PL[level]

    if (isEdit) {
      return (
        <InlineForm
          key={cat.id}
          form={editForm}
          onChange={setEditForm}
          onSave={saveEdit}
          onCancel={() => setEditingId(null)}
          label="Kaydet"
          parentOptions={buildParentOptions(cat.id)}
          indentPx={pl}
        />
      )
    }

    const childCount = getChildren(cat.id).length

    return (
      <div
        key={cat.id}
        className={[
          'group flex items-center gap-2.5 border-b border-border transition-colors cursor-pointer',
          LEVEL_BG[level], 'hover:bg-accent/40',
        ].join(' ')}
        style={{ paddingLeft: pl, paddingRight: 12, paddingTop: level === 0 ? 8 : 5, paddingBottom: level === 0 ? 8 : 5 }}
        onClick={() => !isConf && router.push(`/categories/${cat.id}`)}
      >
        {level > 0 && (
          <span className="text-muted-foreground/40 text-[10px] flex-shrink-0 -ml-1">↳</span>
        )}

        {/* Colored icon */}
        <CategoryIcon icon={cat.icon} color={cat.color} size={ICON_SIZE[level]} className="flex-shrink-0" />

        {/* Name */}
        <span className={`flex-1 truncate min-w-0 text-foreground ${LEVEL_TEXT[level]}`}>
          {cat.name}
        </span>

        {childCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{childCount} alt</span>
        )}
        {count > 0 && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{count} işlem</span>
        )}
        {cat.isSystem && (
          <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 hidden group-hover:inline">sistem</span>
        )}

        {/* Actions */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => startEdit(cat)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Düzenle"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={12} height={12}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
          </button>

          {/* Add sub — only L0 and L1 */}
          {level < 2 && (
            <button
              onClick={() => {
                setAdding(true)
                setAddForm({ ...emptyForm(), parentId: cat.id, color: cat.color })
                setEditingId(null)
              }}
              className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors font-bold text-sm leading-none"
              title="Alt kategori ekle"
            >+</button>
          )}

          {!cat.isSystem && (
            isConf ? (
              <>
                <button onClick={() => handleDelete(cat)}
                  className="px-2 h-6 bg-destructive text-white text-[10px] font-semibold rounded-md">Sil</button>
                <button onClick={() => setConfirmDeleteId(null)}
                  className="w-6 h-6 flex items-center justify-center border border-border rounded-md text-muted-foreground text-xs">✕</button>
              </>
            ) : (
              <button onClick={() => handleDelete(cat)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors text-base leading-none"
                title="Sil">×</button>
            )
          )}
        </div>

        {!isConf && (
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={12} height={12}
            className="text-muted-foreground/30 flex-shrink-0 group-hover:text-muted-foreground/60 transition-colors">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        )}
      </div>
    )
  }

  /* ── 3-level tree ── */
  function renderTree(cats: Category[], level: 0 | 1 | 2) {
    return cats.map(cat => (
      <div key={cat.id}>
        {renderRow(cat, level)}
        {level < 2 && renderTree(getChildren(cat.id), (level + 1) as 1 | 2)}
      </div>
    ))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs + add */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-border flex-shrink-0">
        {(['expense', 'income'] as CategoryScope[]).map(s => (
          <button key={s} onClick={() => handleTabChange(s)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            ].join(' ')}
          >
            {SCOPE_LABELS[s]}
            <span className={`text-[10px] tabular-nums ${tab === s ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
              {categories.filter(c => c.scope === s && !c.parentId).length}
            </span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={startAdd}
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/85 transition-colors">
          <span className="text-sm leading-none">+</span> Yeni Kategori
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <InlineForm
          form={addForm}
          onChange={setAddForm}
          onSave={saveAdd}
          onCancel={() => setAdding(false)}
          label="Ekle"
          parentOptions={buildParentOptions()}
        />
      )}

      {/* Tree */}
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
