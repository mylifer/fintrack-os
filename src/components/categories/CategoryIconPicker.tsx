'use client'

import { useState, useEffect, useRef } from 'react'
import { CATEGORY_ICON_LIST, ICON_MAP } from './CategoryIcon'

interface Props {
  value: string
  color: string
  onChange: (icon: string) => void
}

const GROUPS = Array.from(new Set(CATEGORY_ICON_LIST.map(i => i.group)))

export function CategoryIconPicker({ value, color, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const filtered = search.trim()
    ? CATEGORY_ICON_LIST.filter(i =>
        i.label.toLowerCase().includes(search.toLowerCase()) ||
        i.name.toLowerCase().includes(search.toLowerCase()),
      )
    : CATEGORY_ICON_LIST

  const LIcon    = ICON_MAP[value]
  const isLucide = !!LIcon

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 rounded-xl border-2 border-border hover:border-primary transition-colors flex items-center justify-center"
        style={{ background: isLucide ? color : `${color}22` }}
        title="İkon seç"
      >
        {LIcon
          ? <LIcon size={18} color="white" strokeWidth={1.75} />
          : <span style={{ fontSize: 18 }}>{value || '📦'}</span>
        }
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[320px] rounded-xl border border-border bg-background shadow-xl overflow-hidden">
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

          {/* Icon grid */}
          <div className="overflow-y-auto max-h-[320px] p-2">
            {search.trim() ? (
              <div className="flex flex-wrap gap-1">
                {filtered.map(icon => <IconButton key={icon.name} icon={icon} value={value} color={color} onSelect={n => { onChange(n); setOpen(false) }} />)}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 w-full text-center">Sonuç bulunamadı</p>
                )}
              </div>
            ) : (
              GROUPS.map(group => {
                const items = CATEGORY_ICON_LIST.filter(i => i.group === group)
                return (
                  <div key={group} className="mb-3">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">{group}</div>
                    <div className="flex flex-wrap gap-1">
                      {items.map(icon => <IconButton key={icon.name} icon={icon} value={value} color={color} onSelect={n => { onChange(n); setOpen(false) }} />)}
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
  icon, value, color, onSelect,
}: {
  icon: { name: string; label: string }
  value: string
  color: string
  onSelect: (name: string) => void
}) {
  const LIcon     = ICON_MAP[icon.name]
  const isSelected = value === icon.name
  if (!LIcon) return null
  return (
    <button
      type="button"
      onClick={() => onSelect(icon.name)}
      title={icon.label}
      className={[
        'w-9 h-9 rounded-xl flex items-center justify-center transition-all',
        isSelected
          ? 'ring-2 ring-primary scale-110'
          : 'hover:scale-110 hover:ring-2 hover:ring-border',
      ].join(' ')}
      style={{ background: isSelected ? color : `${color}22` }}
    >
      <LIcon size={16} color={isSelected ? 'white' : color} strokeWidth={1.75} />
    </button>
  )
}
