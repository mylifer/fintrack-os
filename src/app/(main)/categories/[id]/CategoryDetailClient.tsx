'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useCategoryStore, useTransactionStore } from '@/store'
import { TransactionList } from '@/components/transactions/TransactionList'
import { formatCurrency } from '@/lib/utils/currency'

interface Props { id: string }

export default function CategoryDetailClient({ id }: Props) {
  const router     = useRouter()
  const categories = useCategoryStore(s => s.categories)
  const update     = useCategoryStore(s => s.update)
  const transactions = useTransactionStore(s => s.transactions)

  const cat     = categories.find(c => c.id === id)
  const parent  = cat?.parentId ? categories.find(c => c.id === cat.parentId) : undefined
  const children = categories.filter(c => c.parentId === id)

  const [editing,   setEditing]   = useState(false)
  const [editName,  setEditName]  = useState('')
  const [editIcon,  setEditIcon]  = useState('')
  const [editColor, setEditColor] = useState('')

  function startEdit() {
    if (!cat) return
    setEditName(cat.name)
    setEditIcon(cat.icon)
    setEditColor(cat.color)
    setEditing(true)
  }

  async function saveEdit() {
    if (!cat || !editName.trim()) return
    await update(cat.id, { name: editName.trim(), icon: editIcon, color: editColor })
    setEditing(false)
  }

  // Transactions for this category + its sub-categories
  const childIds = children.map(c => c.id)
  const catTxs = useMemo(
    () => transactions.filter(t =>
      t.categoryId === id || childIds.includes(t.categoryId ?? ''),
    ).sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, id, childIds],
  )

  const totalAmount = catTxs.reduce((sum, t) => {
    if (t.type === 'income')   return sum + t.amount
    if (t.type === 'expense')  return sum - t.amount
    return sum
  }, 0)

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
      {/* ── Header ── */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0">
        {/* Back */}
        <button
          onClick={() => router.push('/categories')}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm flex-shrink-0"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={16} height={16}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Kategoriler
        </button>

        <span className="text-border">·</span>

        {/* Breadcrumb */}
        {parent && (
          <>
            <span
              className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              onClick={() => router.push(`/categories/${parent.id}`)}
            >
              {parent.icon} {parent.name}
            </span>
            <span className="text-muted-foreground/40 text-xs">›</span>
          </>
        )}

        {/* Category name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
            style={{ background: `${cat.color}22` }}
          >
            {cat.icon}
          </div>
          <span className="text-sm font-semibold text-foreground truncate">{cat.name}</span>
          {cat.isSystem && (
            <span className="text-[10px] text-muted-foreground/60">sistem</span>
          )}
        </div>

        {/* Edit button */}
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={13} height={13}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            Düzenle
          </button>
        )}
      </div>

      {/* ── Edit form ── */}
      {editing && (
        <div className="flex items-center gap-2 px-6 py-3 bg-accent/20 border-b border-border flex-shrink-0 flex-wrap">
          <input type="text" value={editIcon} maxLength={2}
            onChange={e => setEditIcon(e.target.value)}
            className="w-9 h-8 text-center text-base border border-border rounded-lg bg-background focus:outline-none focus:border-primary" />
          <input type="text" value={editName} autoFocus
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
            className="flex-1 min-w-[140px] text-sm border border-border rounded-lg px-3 h-8 bg-background focus:outline-none focus:border-primary" />
          <label className="relative cursor-pointer" title="Renk seç">
            <div className="w-8 h-8 rounded-lg border border-border" style={{ background: editColor }} />
            <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
          </label>
          <button onClick={saveEdit} disabled={!editName.trim()}
            className="px-3 h-8 bg-primary text-white rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors">
            Kaydet
          </button>
          <button onClick={() => setEditing(false)}
            className="px-2.5 h-8 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
            İptal
          </button>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">İşlem</span>
          <div className="text-sm font-semibold text-foreground tabular-nums">{catTxs.length}</div>
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Toplam</span>
          <div className={`text-sm font-semibold tabular-nums ${totalAmount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
            {formatCurrency(Math.abs(totalAmount))}
          </div>
        </div>
        {children.length > 0 && (
          <div>
            <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Alt Kategori</span>
            <div className="text-sm font-semibold text-foreground">{children.length}</div>
          </div>
        )}
      </div>

      {/* ── Sub-categories (if any) ── */}
      {children.length > 0 && (
        <div className="px-6 py-3 border-b border-border bg-background flex-shrink-0">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Alt Kategoriler</div>
          <div className="flex flex-wrap gap-2">
            {children.map(child => (
              <button
                key={child.id}
                onClick={() => router.push(`/categories/${child.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-accent transition-colors"
                style={{ borderColor: `${child.color}40` }}
              >
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center text-xs"
                  style={{ background: `${child.color}22` }}
                >
                  {child.icon}
                </span>
                {child.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Transaction list ── */}
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
