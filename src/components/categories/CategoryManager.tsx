'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import { CategoryIcon } from './CategoryIcon'
import { CategoryIconPicker } from './CategoryIconPicker'
import type { Category, CategoryScope } from '@/types'

const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }

/* ── Form state ──────────────────────────────────────────────────── */
type FormState = { name: string; icon: string; color: string; parentL0: string; parentL1: string }
function emptyForm(): FormState { return { name: '', icon: 'package', color: '#6366F1', parentL0: '', parentL1: '' } }

/* ── Inline form ─────────────────────────────────────────────────── */
interface InlineFormProps {
  form: FormState
  onChange: (f: FormState) => void
  onSave: () => void
  onCancel: () => void
  label: string
  l0Options: { id: string; label: string }[]
  l1Options: { id: string; label: string }[]
  indentPx?: number
}

function InlineForm({ form, onChange, onSave, onCancel, label, l0Options, l1Options, indentPx = 16 }: InlineFormProps) {
  function pickL0(id: string) { onChange({ ...form, parentL0: id, parentL1: '' }) }
  function pickL1(id: string) { onChange({ ...form, parentL1: id, parentL0: '' }) }

  return (
    <div
      className="flex items-center gap-2 py-2 pr-4 bg-accent/25 border-b border-border flex-wrap"
      style={{ paddingLeft: indentPx }}
    >
      {/* Icon picker */}
      <CategoryIconPicker
        icon={form.icon}
        color={form.color}
        onChange={(icon, color) => onChange({ ...form, icon, color })}
      />

      {/* Name */}
      <input
        type="text" value={form.name} autoFocus placeholder="Kategori adı"
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        className="flex-1 min-w-[120px] text-sm border border-border rounded-lg px-3 h-9 bg-background text-foreground focus:outline-none focus:border-primary"
      />

      {/* Üst Kategori (L0) */}
      {l0Options.length > 0 && (
        <select
          value={form.parentL0}
          onChange={e => pickL0(e.target.value)}
          className="text-xs border border-border rounded-lg px-2 h-9 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[160px]"
          title="Üst kategori"
        >
          <option value="">Üst kategori</option>
          {l0Options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}

      {/* Alt Kategori (L1) */}
      {l1Options.length > 0 && (
        <select
          value={form.parentL1}
          onChange={e => pickL1(e.target.value)}
          className="text-xs border border-border rounded-lg px-2 h-9 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[160px]"
          title="Alt kategori altına ekle"
        >
          <option value="">Alt kategori</option>
          {l1Options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}

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

  const txCount = useCallback((catId: string) => {
    const ids = new Set(getAllDescendants(catId))
    return transactions.filter(t => t.categoryId && ids.has(t.categoryId)).length
  }, [transactions, getAllDescendants])

  const roots = useMemo(
    () => categories.filter(c => c.scope === tab && !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, tab],
  )

  /* L0 options: root categories of current tab, optionally excluding a subtree */
  function buildL0Options(excludeId?: string): { id: string; label: string }[] {
    const excluded = new Set(excludeId ? getAllDescendants(excludeId) : [])
    return categories
      .filter(c => c.scope === tab && getLevel(c.id) === 0 && !excluded.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => ({ id: c.id, label: c.name }))
  }

  /* L1 options: first-level children of current tab, optionally excluding a subtree */
  function buildL1Options(excludeId?: string): { id: string; label: string }[] {
    const excluded = new Set(excludeId ? getAllDescendants(excludeId) : [])
    return categories
      .filter(c => c.scope === tab && getLevel(c.id) === 1 && !excluded.has(c.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => {
        const parent = categories.find(p => p.id === c.parentId)
        return { id: c.id, label: `${c.name} (${parent?.name ?? ''})` }
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
    const parentId = addForm.parentL1 || addForm.parentL0 || undefined
    const cat: Category = {
      id:        crypto.randomUUID(),
      name:      addForm.name.trim(),
      icon:      addForm.icon || 'package',
      color:     addForm.color || '#6366F1',
      scope:     tab,
      parentId,
      isSystem:  false,
      sortOrder: maxSort + 1,
    }
    await add(cat)
    setAdding(false)
    setAddForm(emptyForm())
  }

  function startEdit(cat: Category) {
    const level = getLevel(cat.id)
    setEditingId(cat.id)
    setEditForm({
      name:     cat.name,
      icon:     cat.icon,
      color:    cat.color,
      parentL0: level === 1 ? (cat.parentId ?? '') : '',
      parentL1: level === 2 ? (cat.parentId ?? '') : '',
    })
    setAdding(false)
    setConfirmDeleteId(null)
  }

  async function saveEdit() {
    if (!editingId || !editForm.name.trim()) return
    const parentId = editForm.parentL1 || editForm.parentL0 || undefined
    await update(editingId, {
      name:     editForm.name.trim(),
      icon:     editForm.icon || 'package',
      color:    editForm.color || '#6366F1',
      parentId,
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
          l0Options={buildL0Options(cat.id)}
          l1Options={buildL1Options(cat.id)}
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

        <CategoryIcon icon={cat.icon} color={cat.color} size={ICON_SIZE[level]} className="flex-shrink-0" />

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

          {level < 2 && (
            <button
              onClick={() => {
                setAdding(true)
                setAddForm({ ...emptyForm(), parentL0: getLevel(cat.id) === 0 ? cat.id : '', parentL1: getLevel(cat.id) === 1 ? cat.id : '' })
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
          l0Options={buildL0Options()}
          l1Options={buildL1Options()}
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
