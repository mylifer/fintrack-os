'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { cn } from '@/lib/utils'
import { compareCategoriesByName } from '@/lib/utils/categories'
import type { Category } from '@/types'

const COL_W    = 220
const MAX_H    = 300
const GAP      = 4
const CARD_CLS = 'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10'

interface Props {
  categories: Category[]
  value: string
  onChange: (id: string) => void
  error?: boolean
  placeholder?: string
  /** Aramada sonuç yoksa "yeni ekle" satırı gösterir; yeni kategorinin id'sini döndürmeli. */
  onCreate?: (name: string) => Promise<string | null>
  /**
   * Başka yerde KULLANILMIŞ kategoriler — seçilemez görünür (işlem bölmede aynı
   * kategori iki paya girmesin diye). Kural yalnızca kategorinin KENDİSİNİ
   * kapsar: hiyerarşiye yayılmaz, üst kategori kullanılmış olsa da alt
   * kategorileri seçilebilir kalır. Devre dışı satırın üstüne gelmek yine
   * alt kolonu açar — çocuklarına ulaşmak engellenmez.
   */
  disabledIds?: ReadonlySet<string>
}

const ITEM     = 'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none transition-colors'
const ITEM_DEF = `${ITEM} hover:bg-accent hover:text-accent-foreground`
const ITEM_ACT = `${ITEM} bg-primary text-primary-foreground`

// react-remove-scroll in Dialog calls preventDefault() on wheel events for
// portal content rendered outside the Dialog DOM subtree. This bypasses that:
// scrollTop manipulation is not affected by preventDefault().
function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget
  el.scrollTop += e.deltaY
}

export function CategoryCascadeSelect({ categories, value, onChange, error, placeholder, onCreate, disabledIds }: Props) {
  const [open,      setOpen]      = useState(false)
  const [hoveredL0, setHoveredL0] = useState<string | null>(null)
  const [hoveredL1, setHoveredL1] = useState<string | null>(null)
  const [query,     setQuery]     = useState('')
  const [creating,  setCreating]  = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const active = categories.filter(c => !c.isArchived)

  const getChildren = useCallback(
    (pid: string) => active.filter(c => c.parentId === pid).sort(compareCategoriesByName),
    [active],
  )

  const roots    = active.filter(c => !c.parentId).sort(compareCategoriesByName)
  const selected = categories.find(c => c.id === value)  // intentionally searches all (incl. archived) to display existing selections
  const l1List   = hoveredL0 ? getChildren(hoveredL0) : []
  const l2List   = hoveredL1 ? getChildren(hoveredL1) : []

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return active.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25)
  }, [query, active])

  function select(id: string) {
    onChange(id); setOpen(false); setHoveredL0(null); setHoveredL1(null); setQuery('')
  }
  function hoverL0(id: string) { setHoveredL0(id); setHoveredL1(null) }

  async function createFromQuery() {
    const name = query.trim()
    if (!name || !onCreate || creating) return
    setCreating(true)
    try {
      const id = await onCreate(name)
      if (id) select(id)
    } finally {
      setCreating(false)
    }
  }

  function ItemList({ items, activeId, onHover, onSelect, iconSize }: {
    items: Category[]
    activeId?: string | null
    onHover?: (id: string) => void
    onSelect: (id: string) => void
    iconSize: number
  }) {
    return (
      <>
        {items.map(cat => {
          const hasChildren = getChildren(cat.id).length > 0
          const active = cat.id === activeId
          // Başka bir payda kullanılmış kategori seçilemez — ama üzerine gelmek
          // yine alt kolonu açar, çünkü kural alt kategorilere yayılmaz.
          const taken = !!disabledIds?.has(cat.id) && cat.id !== value
          return (
            <div
              key={cat.id}
              aria-disabled={taken || undefined}
              title={taken ? 'Bu kategori zaten bir paya eklendi' : undefined}
              className={cn(
                active ? ITEM_ACT : taken ? `${ITEM} opacity-40` : ITEM_DEF,
                taken && 'cursor-not-allowed',
              )}
              onMouseEnter={() => onHover?.(cat.id)}
              onClick={() => { if (!taken) onSelect(cat.id) }}
            >
              <CategoryIcon icon={cat.icon} color={cat.color} size={iconSize} className="shrink-0" />
              <span className="flex-1 truncate">{cat.name}</span>
              {hasChildren && <ChevronRightIcon className={cn('size-3 shrink-0', active ? 'opacity-70' : 'opacity-40')} />}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={v => { setOpen(v); if (!v) { setHoveredL0(null); setHoveredL1(null); setQuery('') } }}>

      {/* ── Trigger ── */}
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-invalid={error || undefined}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            'dark:bg-input/30',
            error
              ? 'border-destructive ring-3 ring-destructive/20'
              : 'border-input data-[state=open]:border-ring',
          )}
        >
          {selected ? (
            <span className="flex items-center gap-1.5 flex-1 min-w-0">
              <CategoryIcon icon={selected.icon} color={selected.color} size={13} className="shrink-0" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="flex-1 text-left text-muted-foreground">{placeholder ?? 'Seçin...'}</span>
          )}
          <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>

      {/* ── Portaled content ── */}
      <Popover.Portal>
        <Popover.Content
          sideOffset={GAP}
          align="start"
          avoidCollisions
          onOpenAutoFocus={e => { e.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={e => e.preventDefault()}
          className={[
            'z-[9999] relative',
            CARD_CLS,
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2',
          ].join(' ')}
          style={{ width: COL_W, minWidth: 'var(--radix-popover-trigger-width)' }}
        >
          {/* Search input */}
          <div style={{ padding: '4px 4px 0' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setHoveredL0(null); setHoveredL1(null) }}
              placeholder="Kategori ara..."
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground"
            />
          </div>

          {query.trim() ? (
            /* ── Search results (flat list) ── */
            <div style={{ padding: 4, maxHeight: MAX_H, overflowY: 'auto' }} onWheel={handleWheel}>
              {searchResults.length === 0 ? (
                onCreate ? (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={createFromQuery}
                    className={cn(ITEM_DEF, 'text-primary disabled:opacity-50')}
                  >
                    <PlusIcon className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate text-left">
                      {creating ? 'Ekleniyor...' : <>&ldquo;{query.trim()}&rdquo; kategorisini ekle</>}
                    </span>
                  </button>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">Sonuç bulunamadı</p>
                )
              ) : searchResults.map(cat => {
                const parent = active.find(p => p.id === cat.parentId)
                const taken = !!disabledIds?.has(cat.id) && cat.id !== value
                return (
                  <div
                    key={cat.id}
                    aria-disabled={taken || undefined}
                    title={taken ? 'Bu kategori zaten bir paya eklendi' : undefined}
                    className={cn(
                      cat.id === value ? ITEM_ACT : taken ? `${ITEM} opacity-40` : ITEM_DEF,
                      taken && 'cursor-not-allowed',
                    )}
                    onClick={() => { if (!taken) select(cat.id) }}
                  >
                    <CategoryIcon icon={cat.icon} color={cat.color} size={13} className="shrink-0" />
                    <span className="flex-1 truncate">{cat.name}</span>
                    {parent && <span className="shrink-0 text-xs opacity-40">{parent.name}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            /* ── Cascade (default) ── */
            <>
              <div style={{ padding: 4, maxHeight: MAX_H, overflowY: 'auto' }} onWheel={handleWheel}>
                <ItemList items={roots} activeId={hoveredL0} onHover={hoverL0} onSelect={select} iconSize={13} />
              </div>

              {hoveredL0 && l1List.length > 0 && (
                <div
                  className={`absolute ${CARD_CLS}`}
                  style={{ top: 0, left: COL_W + GAP, width: COL_W, maxHeight: MAX_H, overflowY: 'auto', zIndex: 10 }}
                  onWheel={handleWheel}
                >
                  <div style={{ padding: 4 }}>
                    <ItemList items={l1List} activeId={hoveredL1} onHover={id => setHoveredL1(id)} onSelect={select} iconSize={11} />
                  </div>
                </div>
              )}

              {hoveredL1 && l2List.length > 0 && (
                <div
                  className={`absolute ${CARD_CLS}`}
                  style={{ top: 0, left: (COL_W + GAP) * 2, width: COL_W, maxHeight: MAX_H, overflowY: 'auto', zIndex: 10 }}
                  onWheel={handleWheel}
                >
                  <div style={{ padding: 4 }}>
                    <ItemList items={l2List} activeId={null} onSelect={select} iconSize={10} />
                  </div>
                </div>
              )}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
