'use client'

import { useState, useEffect, useRef } from 'react'
import { TABLER_ICON_LIST, TABLER_MAP, COLOR_PALETTE, DEFAULT_ICON, DEFAULT_COLOR } from './CategoryIcon'

interface Props {
  icon: string
  color: string
  onChange: (icon: string, color: string) => void
}

const GROUPS = Array.from(new Set(TABLER_ICON_LIST.map(i => i.group)))

export function CategoryIconPicker({ icon, color, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const currentIcon  = icon  || DEFAULT_ICON
  const currentColor = color || DEFAULT_COLOR

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const filtered = search.trim()
    ? TABLER_ICON_LIST.filter(i =>
        i.label.toLowerCase().includes(search.toLowerCase()) ||
        i.name.toLowerCase().includes(search.toLowerCase()),
      )
    : TABLER_ICON_LIST

  const TriggerIcon = TABLER_MAP[currentIcon]

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
          : <span className="text-white text-base">?</span>
        }
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[340px] rounded-xl border border-border bg-background shadow-xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="İkon ara…"
              autoFocus
              className="w-full text-xs px-3 h-8 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Color palette */}
          <div className="px-3 pt-2.5 pb-2 border-b border-border">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Renk</div>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange(currentIcon, c)}
                  title={c}
                  className="w-6 h-6 rounded-lg transition-all hover:scale-110 flex-shrink-0"
                  style={{
                    background: c,
                    outline: currentColor === c ? '2px solid white' : 'none',
                    boxShadow: currentColor === c ? `0 0 0 3px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Icon grid */}
          <div className="overflow-y-auto max-h-[280px] p-2">
            {search.trim() ? (
              <div className="flex flex-wrap gap-1">
                {filtered.map(item => (
                  <IconButton
                    key={item.name}
                    item={item}
                    selected={currentIcon === item.name}
                    color={currentColor}
                    onSelect={n => { onChange(n, currentColor); setOpen(false) }}
                  />
                ))}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 w-full text-center">Sonuç bulunamadı</p>
                )}
              </div>
            ) : (
              GROUPS.map(group => {
                const items = TABLER_ICON_LIST.filter(i => i.group === group)
                return (
                  <div key={group} className="mb-3">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">{group}</div>
                    <div className="flex flex-wrap gap-1">
                      {items.map(item => (
                        <IconButton
                          key={item.name}
                          item={item}
                          selected={currentIcon === item.name}
                          color={currentColor}
                          onSelect={n => { onChange(n, currentColor); setOpen(false) }}
                        />
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function IconButton({
  item, selected, color, onSelect,
}: {
  item: { name: string; label: string }
  selected: boolean
  color: string
  onSelect: (name: string) => void
}) {
  const TIcon = TABLER_MAP[item.name]
  if (!TIcon) return null

  return (
    <button
      type="button"
      onClick={() => onSelect(item.name)}
      title={item.label}
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
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:scale-110 transition-transform bg-muted/40 hover:bg-muted/70"
          >
            <TIcon size={18} className="text-foreground/70" stroke={1.75} />
          </span>
        )
      }
    </button>
  )
}
