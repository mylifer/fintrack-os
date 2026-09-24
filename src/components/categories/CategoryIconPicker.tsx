'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import * as TablerIcons from '@tabler/icons-react'
import { TABLER_ICON_NAMES } from '@/lib/tabler-icon-names'
import { tablerComponentName, COLOR_PALETTE, DEFAULT_ICON, DEFAULT_COLOR, TABLER_MAP } from './CategoryIcon'
import { COLOR_PALETTE_GROUPS } from '@/lib/category-palette'
import type { TablerIcon } from '@tabler/icons-react'

interface Props {
  icon: string
  color: string
  onChange: (icon: string, color: string) => void
}

/* ── Convert kebab name to readable label ────────────────────────── */
function toLabel(name: string): string {
  return name.replace(/-/g, ' ')
}

/* ── <input type="color"> yalnızca #rrggbb kabul eder ────────────── */
function colorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_COLOR.toLowerCase()
}

/* ── Get icon component from TablerIcons module ──────────────────── */
function getIcon(name: string): TablerIcon | null {
  const cn = tablerComponentName(name)
  const ic = (TablerIcons as unknown as Record<string, unknown>)[cn]
  return ic != null ? (ic as TablerIcon) : null
}

export function CategoryIconPicker({ icon, color, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const currentIcon  = icon  || DEFAULT_ICON
  const currentColor = color || DEFAULT_COLOR
  const isCustomColor = !COLOR_PALETTE.includes(currentColor.toUpperCase())

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  /* Filter by search query, show all when empty */
  const visibleIcons = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return TABLER_ICON_NAMES as unknown as string[]
    return (TABLER_ICON_NAMES as unknown as string[]).filter(n => n.includes(q))
  }, [search])

  const TriggerIcon = TABLER_MAP[currentIcon] || getIcon(currentIcon)

  function selectIcon(name: string) {
    onChange(name, currentColor)
    setSearch('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 rounded-xl border-2 border-border hover:border-primary transition-colors flex items-center justify-center overflow-hidden"
        style={{ background: currentColor }}
        title="İkon ve renk seç"
      >
        {TriggerIcon
          ? <TriggerIcon size={20} style={{ color: 'white' }} stroke={1.75} />
          : <span className="text-white text-xs font-bold">?</span>
        }
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[360px] rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-border flex-shrink-0">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="İkon ara… (ör: car, home, pizza)"
              autoFocus
              className="w-full text-xs px-3 h-8 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
            <div className="text-[10px] text-muted-foreground mt-1 px-1">
              {visibleIcons.length.toLocaleString()} ikon
            </div>
          </div>

          {/* Color palette */}
          <div className="px-3 pt-2.5 pb-2.5 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Renk</div>
              {/* Paletin dışındaki her renk için tarayıcının renk seçicisi */}
              <label
                className="relative flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                title="Paletin dışında bir renk seç"
              >
                <span
                  className="w-4 h-4 rounded-md flex-shrink-0"
                  style={isCustomColor
                    ? { background: currentColor, boxShadow: `0 0 0 2px var(--background), 0 0 0 3.5px ${currentColor}` }
                    : { background: 'conic-gradient(#EF4444, #EAB308, #22C55E, #06B6D4, #3B82F6, #A855F7, #EC4899, #EF4444)' }}
                />
                Özel renk
                <input
                  type="color"
                  value={colorInputValue(currentColor)}
                  onChange={e => onChange(currentIcon, e.target.value.toUpperCase())}
                  className="sr-only"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2">
              {COLOR_PALETTE_GROUPS.map(group => (
                <div key={group.label} role="group" aria-label={group.label} className="grid grid-cols-10 gap-y-1.5 justify-items-center">
                  {group.colors.map(c => {
                    const selected = currentColor.toUpperCase() === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onChange(currentIcon, c)}
                        title={c}
                        aria-label={c}
                        aria-pressed={selected}
                        className="w-6 h-6 rounded-lg transition-all hover:scale-110 flex-shrink-0"
                        style={{
                          background: c,
                          outline: selected ? '2px solid white' : 'none',
                          boxShadow: selected ? `0 0 0 3px ${c}` : 'none',
                        }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Icon grid — all icons, scrollable */}
          <div className="overflow-y-auto" style={{ maxHeight: 272 }}>
            <div className="p-2 flex flex-wrap gap-1">
              {visibleIcons.map(name => (
                <IconButton
                  key={name}
                  name={name}
                  selected={currentIcon === name}
                  color={currentColor}
                  onSelect={selectIcon}
                />
              ))}
              {visibleIcons.length === 0 && (
                <p className="text-xs text-muted-foreground py-6 w-full text-center">Sonuç bulunamadı</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Single icon button ───────────────────────────────────────────── */
function IconButton({
  name, selected, color, onSelect,
}: {
  name: string
  selected: boolean
  color: string
  onSelect: (name: string) => void
}) {
  const TIcon = getIcon(name)
  if (!TIcon) return null

  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      title={toLabel(name)}
      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
      style={selected ? {
        background: color,
        transform: 'scale(1.1)',
        outline: `2px solid ${color}`,
        outlineOffset: 2,
      } : undefined}
    >
      {selected
        ? <TIcon size={18} style={{ color: 'white' }} stroke={1.75} />
        : (
          <span className="w-9 h-9 rounded-xl flex items-center justify-center hover:scale-110 transition-transform bg-muted/40 hover:bg-muted/70">
            <TIcon size={18} className="text-foreground/70" stroke={1.75} />
          </span>
        )
      }
    </button>
  )
}
