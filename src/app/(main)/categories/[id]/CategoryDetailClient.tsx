'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { CategoryIconPicker } from '@/components/categories/CategoryIconPicker'
import { TransactionList } from '@/components/transactions/TransactionList'
import { formatCurrency } from '@/lib/utils/currency'

interface Props { id: string }

export default function CategoryDetailClient({ id }: Props) {
  const router     = useRouter()
  const categories = useCategoryStore(s => s.categories)
  const update     = useCategoryStore(s => s.update)
  const transactions = useTransactionStore(s => s.transactions)

  const cat = categories.find(c => c.id === id)

  /* ── Helpers ── */
  const getAllDescendants = useCallback((catId: string): string[] => {
    const children = categories.filter(c => c.parentId === catId)
    return [catId, ...children.flatMap(c => getAllDescendants(c.id))]
  }, [categories])

  const getLevel = (catId: string): 0 | 1 | 2 => {
    const c = categories.find(x => x.id === catId)
    if (!c?.parentId) return 0
    const p = categories.find(x => x.id === c.parentId)
    return p?.parentId ? 2 : 1
  }

  /* Ancestor chain */
  const ancestors = useMemo(() => {
    const chain: typeof categories = []
    let cur = cat?.parentId ? categories.find(c => c.id === cat.parentId) : undefined
    while (cur) {
      chain.unshift(cur)
      cur = cur.parentId ? categories.find(c => c.id === cur!.parentId) : undefined
    }
    return chain
  }, [cat, categories])

  /* All descendants */
  const descendantIds = useMemo(
    () => new Set(cat ? getAllDescendants(cat.id) : []),
    [cat, getAllDescendants],
  )

  /* Direct children */
  const children = useMemo(
    () => categories.filter(c => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories, id],
  )

  /* Transactions */
  const catTxs = useMemo(
    () => transactions
      .filter(t => t.categoryId && descendantIds.has(t.categoryId))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, descendantIds],
  )

  const totalAmount = catTxs.reduce((sum, t) => {
    if (t.type === 'income')  return sum + t.amount
    if (t.type === 'expense') return sum - t.amount
    return sum
  }, 0)

  /* ── Valid parents for this category ── */
  const parentOptions = useMemo(() => {
    if (!cat) return []
    const excluded = new Set(getAllDescendants(cat.id))
    return categories
      .filter(c =>
        c.scope === cat.scope &&
        getLevel(c.id) < 2 &&
        !excluded.has(c.id),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(c => ({ id: c.id, label: `${'  ↳ '.repeat(getLevel(c.id))}${c.name}` }))
  }, [cat, categories, getAllDescendants])

  /* ── Edit state ── */
  const [editing,    setEditing]    = useState(false)
  const [editName,   setEditName]   = useState('')
  const [editIcon,   setEditIcon]   = useState('')
  const [editColor,  setEditColor]  = useState('')
  const [editParent, setEditParent] = useState('')

  function startEdit() {
    if (!cat) return
    setEditName(cat.name)
    setEditIcon(cat.icon)
    setEditColor(cat.color)
    setEditParent(cat.parentId ?? '')
    setEditing(true)
  }

  async function saveEdit() {
    if (!cat || !editName.trim()) return
    await update(cat.id, {
      name:     editName.trim(),
      icon:     editIcon || 'Package',
      color:    editColor,
      parentId: editParent || undefined,
    })
    setEditing(false)
  }

  /* ── Not found ── */
  if (!cat) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
          <button onClick={() => router.push('/categories')}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm">
            ← Kategoriler
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Kategori bulunamadı.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header / breadcrumb ── */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0 flex-wrap">
        <button onClick={() => router.push('/categories')}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-sm flex-shrink-0">
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Kategoriler
        </button>

        {ancestors.map(anc => (
          <span key={anc.id} className="flex items-center gap-2 flex-shrink-0">
            <span className="text-border text-xs">›</span>
            <button onClick={() => router.push(`/categories/${anc.id}`)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <CategoryIcon icon={anc.icon} color={anc.color} size={11} />
              {anc.name}
            </button>
          </span>
        ))}

        <span className="text-border text-xs flex-shrink-0">›</span>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CategoryIcon icon={cat.icon} color={cat.color} size={13} />
          <span className="text-sm font-semibold text-foreground truncate">{cat.name}</span>
          {cat.isSystem && <span className="text-[10px] text-muted-foreground/50">sistem</span>}
        </div>

        {!editing && (
          <button onClick={startEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0">
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={12} height={12}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            Düzenle
          </button>
        )}
      </div>

      {/* ── Edit form ── */}
      {editing && (
        <div className="flex items-center gap-2 px-6 py-3 bg-accent/20 border-b border-border flex-shrink-0 flex-wrap">
          {/* Icon picker */}
          <CategoryIconPicker
            value={editIcon}
            color={editColor}
            onChange={setEditIcon}
          />

          {/* Name */}
          <input type="text" value={editName} autoFocus
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
            className="flex-1 min-w-[140px] text-sm border border-border rounded-lg px-3 h-9 bg-background focus:outline-none focus:border-primary" />

          {/* Parent dropdown */}
          <select
            value={editParent}
            onChange={e => setEditParent(e.target.value)}
            className="text-xs border border-border rounded-lg px-2 h-9 bg-background text-foreground focus:outline-none cursor-pointer flex-shrink-0 max-w-[200px]"
          >
            <option value="">Kök (üst yok)</option>
            {parentOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>

          {/* Color */}
          <label className="relative cursor-pointer flex-shrink-0" title="Renk seç">
            <div className="w-9 h-9 rounded-xl border-2 border-border" style={{ background: editColor }} />
            <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
          </label>

          <button onClick={saveEdit} disabled={!editName.trim()}
            className="px-3 h-9 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0">
            Kaydet
          </button>
          <button onClick={() => setEditing(false)}
            className="px-2.5 h-9 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            İptal
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-muted/20 flex-shrink-0">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">İşlem</div>
          <div className="text-sm font-semibold text-foreground tabular-nums">{catTxs.length}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Toplam</div>
          <div className={`text-sm font-semibold tabular-nums ${totalAmount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
            {formatCurrency(Math.abs(totalAmount))}
          </div>
        </div>
        {descendantIds.size > 1 && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Alt Kategori</div>
            <div className="text-sm font-semibold text-foreground">{descendantIds.size - 1}</div>
          </div>
        )}
      </div>

      {/* ── Children chips ── */}
      {children.length > 0 && (
        <div className="px-6 py-3 border-b border-border bg-background flex-shrink-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Alt Kategoriler</div>
          <div className="flex flex-wrap gap-1.5">
            {children.map(child => (
              <button key={child.id} onClick={() => router.push(`/categories/${child.id}`)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent transition-colors"
                style={{ borderColor: `${child.color}40` }}>
                <CategoryIcon icon={child.icon} color={child.color} size={11} />
                {child.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Transactions ── */}
      <div className="flex-1 overflow-y-auto">
        <TransactionList
          transactions={catTxs}
          showAccount
          emptyTitle="İşlem bulunamadı"
          emptyDescription="Bu kategoriye ait henüz işlem yok."
        />
      </div>
    </div>
  )
}
