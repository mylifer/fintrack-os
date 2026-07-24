'use client'

import { useState } from 'react'
import { useCategoryStore } from '@/store'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { CategoryIconPicker } from '../CategoryIconPicker'
import { SelectField } from '@/components/ui/Select'
import { useCategoryData, SCOPE_LABELS } from './shared'
import { CardsView } from './CardsView'
import { LedgerView } from './LedgerView'
import { SplitView } from './SplitView'
import type { Category, CategoryScope } from '@/types'

/* ── View registry ─────────────────────────────────────────────────
 * Four candidate designs the user can flip between and pick from.
 * The active view is remembered in localStorage so a refresh keeps it.
 * ------------------------------------------------------------------ */
const VIEWS = [
  { id: 'cards',  label: 'Kartlar',   icon: GridIcon,  Comp: CardsView },
  { id: 'ledger', label: 'Defter',    icon: ListIcon,  Comp: LedgerView },
  { id: 'split',  label: 'Bölünmüş',  icon: SplitIcon, Comp: SplitView },
] as const

type ViewId = (typeof VIEWS)[number]['id']
const STORAGE_KEY = 'categories.viewMode'

export function CategoryViewsShell() {
  const categories = useCategoryStore(s => s.categories)
  const add        = useCategoryStore(s => s.add)

  const [scope, setScope]   = useState<CategoryScope>('expense')
  // restore persisted view choice lazily (client-only; SSR falls back to 'cards')
  const [view, setView]     = useState<ViewId>(() => {
    if (typeof window === 'undefined') return 'cards'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved && VIEWS.some(v => v.id === saved) ? (saved as ViewId) : 'cards'
  })
  const [adding, setAdding] = useState(false)

  function pickView(id: ViewId) {
    setView(id)
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }

  const data = useCategoryData(scope)
  const Active = VIEWS.find(v => v.id === view)!.Comp

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── toolbar ── */}
      <div className="flex items-center gap-2 px-3 lg:px-4 py-2.5 border-b border-border flex-shrink-0 flex-wrap">
        {/* scope tabs */}
        <div className="flex items-center gap-1">
          {(['expense', 'income'] as CategoryScope[]).map(s => (
            <button key={s} onClick={() => { setScope(s); setAdding(false) }}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                scope === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              {SCOPE_LABELS[s]}
              <span className={`text-[10px] tabular-nums ${scope === s ? 'text-primary/70' : 'text-muted-foreground/60'}`}>
                {data.rootCount(s)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* view switcher */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/60 border border-border">
          {VIEWS.map(v => {
            const Icon = v.icon
            const on = v.id === view
            return (
              <button key={v.id} onClick={() => pickView(v.id)} title={v.label}
                className={[
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon />
                <span className="hidden md:inline">{v.label}</span>
              </button>
            )
          })}
        </div>

        <button onClick={() => setAdding(a => !a)}
          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/85 transition-colors flex-shrink-0">
          <span className="text-sm leading-none">+</span> Yeni Kategori
        </button>
      </div>

      {/* ── inline add form ── */}
      {adding && (
        <QuickAdd
          scope={scope}
          categories={categories}
          onCancel={() => setAdding(false)}
          onSave={async cat => { await add(cat); setAdding(false) }}
        />
      )}

      {/* ── active view ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Active data={data} />
      </div>
    </div>
  )
}

/* ── Shared quick-add form (chrome — same across all views) ───────── */
function QuickAdd({
  scope, categories, onSave, onCancel,
}: {
  scope: CategoryScope
  categories: Category[]
  onSave: (cat: Category) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName]   = useState('')
  const [icon, setIcon]   = useState('package')
  const [color, setColor] = useState('#6366F1')
  const [l0, setL0]       = useState('')
  const [l1, setL1]       = useState('')

  const levelOf = (id: string): 0 | 1 | 2 => {
    const c = categories.find(x => x.id === id)
    if (!c?.parentId) return 0
    const p = categories.find(x => x.id === c.parentId)
    return p?.parentId ? 2 : 1
  }
  const l0Options = categories
    .filter(c => c.scope === scope && !c.isArchived && levelOf(c.id) === 0)
    .sort(compareCategoriesByName)
  const l1Options = categories
    .filter(c => c.scope === scope && !c.isArchived && levelOf(c.id) === 1)
    .sort(compareCategoriesByName)

  function save() {
    if (!name.trim()) return
    const maxSort = categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
    onSave({
      id:        crypto.randomUUID(),
      name:      name.trim(),
      icon:      icon || 'package',
      color:     color || '#6366F1',
      scope,
      parentId:  l1 || l0 || undefined,
      isSystem:  false,
      sortOrder: maxSort + 1,
    })
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-accent/25 border-b border-border flex-wrap flex-shrink-0">
      <CategoryIconPicker icon={icon} color={color} onChange={(i, c) => { setIcon(i); setColor(c) }} />
      <input
        type="text" value={name} autoFocus placeholder="Kategori adı"
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save() }}
        className="flex-1 min-w-[120px] text-sm border border-border rounded-lg px-3 h-9 bg-background text-foreground focus:outline-none focus:border-primary"
      />
      {l0Options.length > 0 && (
        <SelectField
          value={l0}
          onChange={e => { setL0(e.target.value); setL1('') }}
          options={[{ value: '', label: 'Üst kategori' }, ...l0Options.map(o => ({ value: o.id, label: o.name }))]}
          className="w-fit max-w-[160px] flex-shrink-0 rounded-lg bg-background text-xs"
        />
      )}
      {l1Options.length > 0 && (
        <SelectField
          value={l1}
          onChange={e => { setL1(e.target.value); setL0('') }}
          options={[{ value: '', label: 'Alt kategori' }, ...l1Options.map(o => {
            const p = categories.find(x => x.id === o.parentId)
            return { value: o.id, label: `${o.name} (${p?.name ?? ''})` }
          })]}
          className="w-fit max-w-[160px] flex-shrink-0 rounded-lg bg-background text-xs"
        />
      )}
      <button onClick={save} disabled={!name.trim()}
        className="px-3 h-9 bg-primary text-primary-foreground rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-primary/85 transition-colors flex-shrink-0">
        Ekle
      </button>
      <button onClick={onCancel}
        className="px-2.5 h-9 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        İptal
      </button>
    </div>
  )
}

/* ── switcher glyphs ───────────────────────────────────────────────── */
function GridIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
}
function ListIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
}
function SplitIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16" strokeLinecap="round"/></svg>
}
