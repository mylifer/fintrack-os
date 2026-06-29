'use client'

import { useState, useCallback } from 'react'
import { Popover } from 'radix-ui'
import { CategoryIcon } from './CategoryIcon'
import type { Category } from '@/types'

const COL_W    = 220
const MAX_H    = 300
const GAP      = 4
const CARD_CLS = 'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10'

const ChevronDown = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={14} height={14}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
)
const ChevronRight = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={11} height={11}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
  </svg>
)

interface Props {
  categories: Category[]
  value: string
  onChange: (id: string) => void
  error?: boolean
  placeholder?: string
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

export function CategoryCascadeSelect({ categories, value, onChange, error, placeholder }: Props) {
  const [open,      setOpen]      = useState(false)
  const [hoveredL0, setHoveredL0] = useState<string | null>(null)
  const [hoveredL1, setHoveredL1] = useState<string | null>(null)

  const getChildren = useCallback(
    (pid: string) => categories.filter(c => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  const roots    = categories.filter(c => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  const selected = categories.find(c => c.id === value)
  const l1List   = hoveredL0 ? getChildren(hoveredL0) : []
  const l2List   = hoveredL1 ? getChildren(hoveredL1) : []

  function select(id: string) {
    onChange(id); setOpen(false); setHoveredL0(null); setHoveredL1(null)
  }
  function hoverL0(id: string) { setHoveredL0(id); setHoveredL1(null) }

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
          return (
            <div
              key={cat.id}
              className={active ? ITEM_ACT : ITEM_DEF}
              onMouseEnter={() => onHover?.(cat.id)}
              onClick={() => onSelect(cat.id)}
            >
              <CategoryIcon icon={cat.icon} color={cat.color} size={iconSize} className="shrink-0" />
              <span className="flex-1 truncate">{cat.name}</span>
              {hasChildren && <span className={active ? 'opacity-70' : 'opacity-40'}><ChevronRight /></span>}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={v => { setOpen(v); if (!v) { setHoveredL0(null); setHoveredL1(null) } }}>

      {/* ── Trigger ── */}
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-invalid={error || undefined}
          className={[
            'flex w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent px-2.5 py-2 text-sm transition-colors outline-none',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
            error
              ? 'border-destructive ring-3 ring-destructive/20'
              : 'border-input hover:border-ring/50 data-[state=open]:border-ring',
          ].join(' ')}
        >
          {selected ? (
            <span className="flex items-center gap-1.5 flex-1 min-w-0">
              <CategoryIcon icon={selected.icon} color={selected.color} size={13} className="shrink-0" />
              <span className="truncate">{selected.name}</span>
            </span>
          ) : (
            <span className="flex-1 text-muted-foreground">{placeholder ?? 'Seçin...'}</span>
          )}
          <span className="opacity-50 shrink-0"><ChevronDown /></span>
        </button>
      </Popover.Trigger>

      {/* ── Portaled content ── */}
      <Popover.Portal>
        <Popover.Content
          sideOffset={GAP}
          align="start"
          avoidCollisions
          onOpenAutoFocus={e => e.preventDefault()}
          className={[
            'z-[9999] relative',
            CARD_CLS,
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2',
          ].join(' ')}
          style={{ width: COL_W, minWidth: 'var(--radix-popover-trigger-width)' }}
        >
          {/* L0 — onWheel bypasses react-remove-scroll's preventDefault() */}
          <div
            style={{ padding: 4, maxHeight: MAX_H, overflowY: 'auto' }}
            onWheel={handleWheel}
          >
            <ItemList
              items={roots}
              activeId={hoveredL0}
              onHover={hoverL0}
              onSelect={select}
              iconSize={13}
            />
          </div>

          {/* L1 */}
          {hoveredL0 && l1List.length > 0 && (
            <div
              className={`absolute ${CARD_CLS}`}
              style={{ top: 0, left: COL_W + GAP, width: COL_W, maxHeight: MAX_H, overflowY: 'auto', zIndex: 10 }}
              onWheel={handleWheel}
            >
              <div style={{ padding: 4 }}>
                <ItemList
                  items={l1List}
                  activeId={hoveredL1}
                  onHover={id => setHoveredL1(id)}
                  onSelect={select}
                  iconSize={11}
                />
              </div>
            </div>
          )}

          {/* L2 */}
          {hoveredL1 && l2List.length > 0 && (
            <div
              className={`absolute ${CARD_CLS}`}
              style={{ top: 0, left: (COL_W + GAP) * 2, width: COL_W, maxHeight: MAX_H, overflowY: 'auto', zIndex: 10 }}
              onWheel={handleWheel}
            >
              <div style={{ padding: 4 }}>
                <ItemList
                  items={l2List}
                  activeId={null}
                  onSelect={select}
                  iconSize={10}
                />
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
