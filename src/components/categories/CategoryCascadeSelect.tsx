'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { CategoryIcon } from './CategoryIcon'
import type { Category } from '@/types'

const ChevronDown = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={12} height={12}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
)
const ChevronRight = () => (
  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={10} height={10}>
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
  const [hoveredL0, setHoveredL0] = useState<string | null>(null)
  const [hoveredL1, setHoveredL1] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setHoveredL0(null); setHoveredL1(null)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

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

  function toggleOpen() {
    setOpen(o => !o)
    if (open) { setHoveredL0(null); setHoveredL1(null) }
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggleOpen}
        className={[
          'w-full flex items-center gap-2 px-3 h-10 border rounded-xl text-left transition-colors bg-background',
          error
            ? 'border-destructive'
            : open ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-primary/50',
        ].join(' ')}
      >
        {selected ? (
          <>
            <CategoryIcon icon={selected.icon} color={selected.color} size={13} className="flex-shrink-0" />
            <span className="flex-1 truncate text-foreground text-sm">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-muted-foreground text-sm">{placeholder ?? 'Kategori seçin'}</span>
        )}
        <span className={`text-muted-foreground/60 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <ChevronDown />
        </span>
      </button>

      {/* Panels — all positioned relative to the trigger */}
      {open && (
        <>
          {/* L0 panel */}
          <div className="absolute left-0 top-full mt-1 z-[200] w-[210px] max-h-[300px] overflow-y-auto bg-background border border-border rounded-xl shadow-xl">
            <div className="py-1">
              {roots.map(cat => {
                const l1 = getChildren(cat.id)
                const hasL1 = l1.length > 0
                return (
                  <div
                    key={cat.id}
                    className={[
                      'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors select-none',
                      hoveredL0 === cat.id ? 'bg-accent' : 'hover:bg-accent',
                    ].join(' ')}
                    onMouseEnter={() => { setHoveredL0(cat.id); setHoveredL1(null) }}
                    onClick={() => select(cat.id)}
                  >
                    <CategoryIcon icon={cat.icon} color={cat.color} size={13} className="flex-shrink-0" />
                    <span className="flex-1 truncate text-foreground">{cat.name}</span>
                    {hasL1 && (
                      <span className="text-muted-foreground/50 flex-shrink-0"><ChevronRight /></span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* L1 panel */}
          {hoveredL0 && l1List.length > 0 && (
            <div className="absolute left-[214px] top-full mt-1 z-[200] w-[210px] max-h-[300px] overflow-y-auto bg-background border border-border rounded-xl shadow-xl">
              <div className="py-1">
                {l1List.map(l1cat => {
                  const l2 = getChildren(l1cat.id)
                  const hasL2 = l2.length > 0
                  return (
                    <div
                      key={l1cat.id}
                      className={[
                        'flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors select-none',
                        hoveredL1 === l1cat.id ? 'bg-accent' : 'hover:bg-accent',
                      ].join(' ')}
                      onMouseEnter={() => setHoveredL1(l1cat.id)}
                      onClick={() => select(l1cat.id)}
                    >
                      <CategoryIcon icon={l1cat.icon} color={l1cat.color} size={11} className="flex-shrink-0" />
                      <span className="flex-1 truncate text-foreground">{l1cat.name}</span>
                      {hasL2 && (
                        <span className="text-muted-foreground/50 flex-shrink-0"><ChevronRight /></span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* L2 panel */}
          {hoveredL1 && l2List.length > 0 && (
            <div className="absolute left-[428px] top-full mt-1 z-[200] w-[200px] max-h-[300px] overflow-y-auto bg-background border border-border rounded-xl shadow-xl">
              <div className="py-1">
                {l2List.map(l2cat => (
                  <div
                    key={l2cat.id}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs hover:bg-accent transition-colors select-none"
                    onClick={() => select(l2cat.id)}
                  >
                    <CategoryIcon icon={l2cat.icon} color={l2cat.color} size={10} className="flex-shrink-0" />
                    <span className="flex-1 truncate text-foreground">{l2cat.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
