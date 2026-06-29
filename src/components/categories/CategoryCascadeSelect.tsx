'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CategoryIcon } from './CategoryIcon'
import type { Category } from '@/types'

const PANEL_W = 224

const ChevronDown = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={14} height={14} className="shrink-0 opacity-50">
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
)
const ChevronRight = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={12} height={12} className="shrink-0 opacity-40">
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

export function CategoryCascadeSelect({ categories, value, onChange, error, placeholder }: Props) {
  const [open,      setOpen]      = useState(false)
  const [mounted,   setMounted]   = useState(false)
  const [hoveredL0, setHoveredL0] = useState<string | null>(null)
  const [hoveredL1, setHoveredL1] = useState<string | null>(null)
  const [coords,    setCoords]    = useState({ top: 0, left: 0, width: 0 })

  const triggerRef = useRef<HTMLButtonElement>(null)
  const portalRef  = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  /* Measure trigger position */
  function measureTrigger() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width })
  }

  /* Reposition on scroll / resize */
  useEffect(() => {
    if (!open) return
    const update = () => measureTrigger()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  /* Close on outside click */
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !portalRef.current?.contains(t)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function close() { setOpen(false); setHoveredL0(null); setHoveredL1(null) }

  function toggle() {
    if (open) { close(); return }
    measureTrigger()
    setOpen(true)
  }

  const getChildren = useCallback(
    (pid: string) => categories.filter(c => c.parentId === pid).sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  const roots    = categories.filter(c => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  const selected = categories.find(c => c.id === value)
  const l1List   = hoveredL0 ? getChildren(hoveredL0) : []
  const l2List   = hoveredL1 ? getChildren(hoveredL1) : []

  function select(id: string) { onChange(id); close() }

  /* ── Shared panel styles (matches shadcn SelectContent) ── */
  const panelCls = 'overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 max-h-[300px]'
  const itemCls  = (hovered: boolean) =>
    `flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none transition-colors ${
      hovered ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'
    }`

  /* ── Portal panels ── */
  const portal = mounted && open && createPortal(
    <div
      ref={portalRef}
      style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999, display: 'flex', gap: 4, alignItems: 'flex-start' }}
    >
      {/* L0 panel — at least as wide as the trigger */}
      <div className={panelCls} style={{ minWidth: Math.max(PANEL_W, coords.width) }}>
        <div className="p-1">
          {roots.map(cat => {
            const hasL1  = getChildren(cat.id).length > 0
            const active = hoveredL0 === cat.id
            return (
              <div
                key={cat.id}
                className={itemCls(active)}
                onMouseEnter={() => { setHoveredL0(cat.id); setHoveredL1(null) }}
                onClick={() => select(cat.id)}
              >
                <CategoryIcon icon={cat.icon} color={cat.color} size={13} className="shrink-0" />
                <span className="flex-1 truncate">{cat.name}</span>
                {hasL1 && <ChevronRight />}
              </div>
            )
          })}
        </div>
      </div>

      {/* L1 panel */}
      {hoveredL0 && l1List.length > 0 && (
        <div className={panelCls} style={{ width: PANEL_W }}>
          <div className="p-1">
            {l1List.map(l1cat => {
              const hasL2  = getChildren(l1cat.id).length > 0
              const active = hoveredL1 === l1cat.id
              return (
                <div
                  key={l1cat.id}
                  className={itemCls(active)}
                  onMouseEnter={() => setHoveredL1(l1cat.id)}
                  onClick={() => select(l1cat.id)}
                >
                  <CategoryIcon icon={l1cat.icon} color={l1cat.color} size={11} className="shrink-0" />
                  <span className="flex-1 truncate">{l1cat.name}</span>
                  {hasL2 && <ChevronRight />}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* L2 panel */}
      {hoveredL1 && l2List.length > 0 && (
        <div className={panelCls} style={{ width: PANEL_W }}>
          <div className="p-1">
            {l2List.map(l2cat => (
              <div
                key={l2cat.id}
                className={itemCls(false)}
                onClick={() => select(l2cat.id)}
              >
                <CategoryIcon icon={l2cat.icon} color={l2cat.color} size={10} className="shrink-0" />
                <span className="flex-1 truncate">{l2cat.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )

  /* ── Trigger (matches shadcn SelectTrigger look) ── */
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-invalid={error || undefined}
        className={[
          'flex w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent px-2.5 py-2 text-sm transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          error
            ? 'border-destructive ring-3 ring-destructive/20'
            : 'border-input hover:border-ring/50',
        ].join(' ')}
      >
        {selected ? (
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            <CategoryIcon icon={selected.icon} color={selected.color} size={13} className="shrink-0" />
            <span className="truncate text-sm">{selected.name}</span>
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground text-sm">{placeholder ?? 'Seçin...'}</span>
        )}
        <ChevronDown />
      </button>

      {portal}
    </>
  )
}
