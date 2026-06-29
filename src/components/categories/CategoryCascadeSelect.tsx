'use client'

import { useState, useCallback } from 'react'
import { Popover } from 'radix-ui'
import { CategoryIcon } from './CategoryIcon'
import type { Category } from '@/types'

const COL_W = 220

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

const ITEM = 'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none transition-colors'
const ITEM_HOVER  = `${ITEM} hover:bg-accent hover:text-accent-foreground`
const ITEM_ACTIVE = `${ITEM} bg-primary text-primary-foreground`

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
    onChange(id)
    setOpen(false)
    setHoveredL0(null)
    setHoveredL1(null)
  }

  function hoverL0(id: string) {
    setHoveredL0(id)
    setHoveredL1(null)
  }

  const colCls = 'flex flex-col overflow-y-auto max-h-[320px] p-1'

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* ── Trigger — matches shadcn SelectTrigger ── */}
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

      {/* ── Content — portaled by Radix, no overflow issues ── */}
      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          avoidCollisions
          onOpenAutoFocus={e => e.preventDefault()}
          className={[
            'z-[9999] flex rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2',
          ].join(' ')}
          style={{ minWidth: `var(--radix-popover-trigger-width)` }}
        >
          {/* L0 column */}
          <div className={colCls} style={{ width: COL_W }}>
            {roots.map(cat => {
              const hasL1  = getChildren(cat.id).length > 0
              const active = hoveredL0 === cat.id
              return (
                <div
                  key={cat.id}
                  className={active ? ITEM_ACTIVE : ITEM_HOVER}
                  onMouseEnter={() => hoverL0(cat.id)}
                  onClick={() => select(cat.id)}
                >
                  <CategoryIcon icon={cat.icon} color={cat.color} size={13} className="shrink-0" />
                  <span className="flex-1 truncate">{cat.name}</span>
                  {hasL1 && <span className={active ? 'opacity-70' : 'opacity-40'}><ChevronRight /></span>}
                </div>
              )
            })}
          </div>

          {/* L1 column */}
          {hoveredL0 && l1List.length > 0 && (
            <div className={`${colCls} border-l border-border`} style={{ width: COL_W }}>
              {l1List.map(l1cat => {
                const hasL2  = getChildren(l1cat.id).length > 0
                const active = hoveredL1 === l1cat.id
                return (
                  <div
                    key={l1cat.id}
                    className={active ? ITEM_ACTIVE : ITEM_HOVER}
                    onMouseEnter={() => setHoveredL1(l1cat.id)}
                    onClick={() => select(l1cat.id)}
                  >
                    <CategoryIcon icon={l1cat.icon} color={l1cat.color} size={11} className="shrink-0" />
                    <span className="flex-1 truncate">{l1cat.name}</span>
                    {hasL2 && <span className={active ? 'opacity-70' : 'opacity-40'}><ChevronRight /></span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* L2 column */}
          {hoveredL1 && l2List.length > 0 && (
            <div className={`${colCls} border-l border-border`} style={{ width: COL_W }}>
              {l2List.map(l2cat => (
                <div
                  key={l2cat.id}
                  className={ITEM_HOVER}
                  onClick={() => select(l2cat.id)}
                >
                  <CategoryIcon icon={l2cat.icon} color={l2cat.color} size={10} className="shrink-0" />
                  <span className="flex-1 truncate">{l2cat.name}</span>
                </div>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
