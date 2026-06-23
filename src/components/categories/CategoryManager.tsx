'use client'

import { useState, useMemo } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { useCategoryStore } from '@/store'
import type { Category, CategoryScope } from '@/types'

/* ── Form state ────────────────────────────────────────────────── */

type Form = { name: string; icon: string; color: string; scope: CategoryScope }

function emptyForm(scope?: CategoryScope): Form {
  return { name: '', icon: '📦', color: '#6B8F80', scope: scope ?? 'expense' }
}

const SCOPE_LABELS: Record<CategoryScope, string> = {
  expense: 'Gider', income: 'Gelir', both: 'Her ikisi',
}

const SCOPE_COLORS: Record<CategoryScope, string> = {
  expense: '#DC2626', income: '#16A34A', both: '#2563EB',
}

/* ── CategoryFormRow — defined at module level so reference is stable ── */

interface FormRowProps {
  form: Form
  onChange: (f: Form) => void
  onSave: () => void
  onCancel: () => void
  label: string
  indent?: boolean
}

function CategoryFormRow({ form, onChange, onSave, onCancel, label, indent }: FormRowProps) {
  return (
    <div
      className={[
        'flex items-center gap-2 px-5 py-3 bg-ground border-b border-border',
        indent ? 'pl-14' : '',
      ].join(' ')}
    >
      {/* Icon */}
      <input
        type="text"
        value={form.icon}
        onChange={e => onChange({ ...form, icon: e.target.value })}
        placeholder="📦"
        maxLength={2}
        className="w-10 h-9 text-center text-xl border border-border rounded-lg bg-ground text-ink focus:outline-none focus:border-primary"
      />

      {/* Name */}
      <input
        type="text"
        value={form.name}
        onChange={e => onChange({ ...form, name: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) onSave() }}
        placeholder="Kategori adı"
        autoFocus
        className="flex-1 text-sm border border-border rounded-lg px-3 h-9 bg-ground text-ink focus:outline-none focus:border-primary"
      />

      {/* Scope */}
      <select
        value={form.scope}
        onChange={e => onChange({ ...form, scope: e.target.value as CategoryScope })}
        className="text-xs border border-border rounded-lg px-2 h-9 bg-ground text-ink focus:outline-none cursor-pointer flex-shrink-0"
      >
        <option value="expense">Gider</option>
        <option value="income">Gelir</option>
        <option value="both">Her ikisi</option>
      </select>

      {/* Color picker */}
      <label className="relative flex-shrink-0 cursor-pointer" title="Renk seç">
        <div
          className="w-9 h-9 rounded-lg border border-border overflow-hidden"
          style={{ background: form.color }}
        />
        <input
          type="color"
          value={form.color}
          onChange={e => onChange({ ...form, color: e.target.value })}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* Save */}
      <button
        onClick={onSave}
        disabled={!form.name.trim()}
        className="px-3 h-9 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0"
      >
        {label}
      </button>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="px-3 h-9 rounded-lg border border-border text-xs text-muted hover:text-ink transition-colors flex-shrink-0"
      >
        İptal
      </button>
    </div>
  )
}

/* ── CategoryManager ────────────────────────────────────────────── */

export function CategoryManager() {
  const categories = useCategoryStore(s => s.categories)
  const add        = useCategoryStore(s => s.add)
  const update     = useCategoryStore(s => s.update)
  const remove     = useCategoryStore(s => s.remove)

  const [editingId,      setEditingId]      = useState<string | null>(null)
  const [editForm,       setEditForm]       = useState<Form>(emptyForm())
  const [addingFor,      setAddingFor]      = useState<'root' | string | null>(null)
  const [addForm,        setAddForm]        = useState<Form>(emptyForm())
  const [confirmDeleteId, setConfirmDelete] = useState<string | null>(null)

  const parents     = useMemo(() => categories.filter(c => !c.parentId), [categories])
  const getChildren = (pid: string) => categories.filter(c => c.parentId === pid)

  /* handlers */
  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditForm({ name: cat.name, icon: cat.icon, color: cat.color, scope: cat.scope })
    setAddingFor(null)
    setConfirmDelete(null)
  }

  async function saveEdit() {
    if (!editingId) return
    await update(editingId, editForm)
    setEditingId(null)
  }

  function startAdd(parentId: 'root' | string, scope?: CategoryScope) {
    setAddingFor(parentId)
    setAddForm(emptyForm(scope))
    setEditingId(null)
    setConfirmDelete(null)
  }

  async function saveAdd() {
    if (!addingFor || !addForm.name.trim()) return
    const maxSort = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    const cat: Category = {
      id:        crypto.randomUUID(),
      name:      addForm.name.trim(),
      icon:      addForm.icon || '📦',
      color:     addForm.color,
      scope:     addForm.scope,
      parentId:  addingFor === 'root' ? undefined : addingFor,
      isSystem:  false,
      sortOrder: maxSort + 1,
    }
    await add(cat)
    setAddingFor(null)
  }

  async function handleDelete(cat: Category) {
    if (confirmDeleteId !== cat.id) { setConfirmDelete(cat.id); return }
    for (const sub of getChildren(cat.id)) await remove(sub.id)
    await remove(cat.id)
    setConfirmDelete(null)
  }

  /* row renderer (inlined to avoid component-type changes) */
  function renderRow(cat: Category, indent: boolean) {
    if (editingId === cat.id) {
      return (
        <CategoryFormRow
          key={cat.id}
          form={editForm}
          onChange={setEditForm}
          onSave={saveEdit}
          onCancel={() => setEditingId(null)}
          label="Kaydet"
          indent={indent}
        />
      )
    }

    const subs = getChildren(cat.id)
    const isConfirm = confirmDeleteId === cat.id

    return (
      <div
        key={cat.id}
        className={[
          'flex items-center gap-3 px-5 py-3 border-b border-border hover:bg-white/[0.03] group transition-colors',
          indent ? 'pl-14' : '',
        ].join(' ')}
      >
        {/* Icon container */}
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0"
          style={{ background: `${cat.color}22` }}
        >
          {cat.icon}
        </div>

        {/* Name */}
        <span className="flex-1 text-sm font-medium text-ink min-w-0 truncate">{cat.name}</span>

        {/* Scope pill */}
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            color:      SCOPE_COLORS[cat.scope],
            background: `${SCOPE_COLORS[cat.scope]}14`,
          }}
        >
          {SCOPE_LABELS[cat.scope]}
        </span>

        {/* System badge */}
        {cat.isSystem && (
          <span className="text-[10px] font-medium text-muted flex-shrink-0">Sistem</span>
        )}

        {/* Sub-count */}
        {subs.length > 0 && (
          <span className="text-[10px] text-muted flex-shrink-0">{subs.length} alt</span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {/* Edit */}
          <button
            onClick={() => startEdit(cat)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-white/[0.08] transition-colors text-xs"
            title="Düzenle"
          >✎</button>

          {/* Add sub (only root level) */}
          {!indent && (
            <button
              onClick={() => startAdd(cat.id, cat.scope)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-accent hover:bg-white/[0.08] transition-colors font-bold text-sm leading-none"
              title="Alt kategori ekle"
            >+</button>
          )}

          {/* Delete (non-system only) */}
          {!cat.isSystem && (
            isConfirm ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDelete(cat)}
                  className="px-2 h-7 rounded-lg bg-danger text-white text-[10px] font-semibold hover:bg-danger/80 transition-colors"
                >
                  Sil
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center border border-border text-muted text-xs hover:text-ink transition-colors"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleDelete(cat)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-white/[0.08] transition-colors text-base leading-none"
                title="Sil"
              >×</button>
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <Card className="overflow-hidden gap-0 py-0">
      {/* Header */}
      <CardHeader className="flex-row items-center justify-between px-5 py-4 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Kategoriler
        </span>
        <button
          onClick={() => startAdd('root')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/85 transition-colors"
        >
          <span className="text-base leading-none">+</span> Yeni Kategori
        </button>
      </CardHeader>

      {/* Category list */}
      <CardContent className="p-0">
        {parents.map(parent => {
          const subs = getChildren(parent.id)
          return (
            <div key={parent.id}>
              {renderRow(parent, false)}

              {/* Sub-categories */}
              {subs.map(sub => renderRow(sub, true))}

              {/* Add sub-category form */}
              {addingFor === parent.id && (
                <CategoryFormRow
                  form={addForm}
                  onChange={setAddForm}
                  onSave={saveAdd}
                  onCancel={() => setAddingFor(null)}
                  label="Ekle"
                  indent
                />
              )}
            </div>
          )
        })}

        {/* Add root category form */}
        {addingFor === 'root' && (
          <CategoryFormRow
            form={addForm}
            onChange={setAddForm}
            onSave={saveAdd}
            onCancel={() => setAddingFor(null)}
            label="Ekle"
          />
        )}

        {/* Empty state */}
        {parents.length === 0 && addingFor !== 'root' && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Henüz kategori yok.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
