'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import { NOTO_ICON_LIST } from './CategoryIcon'

interface Props {
  value: string
  onChange: (icon: string) => void
}

const GROUPS = Array.from(new Set(NOTO_ICON_LIST.map(i => i.group)))

export function CategoryIconPicker({ value, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const filtered = search.trim()
    ? NOTO_ICON_LIST.filter(i =>
        i.label.toLowerCase().includes(search.toLowerCase()) ||
        i.name.toLowerCase().includes(search.toLowerCase()),
      )
    : NOTO_ICON_LIST

  const currentIcon = value || 'noto:package'

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 rounded-xl border-2 border-border hover:border-primary transition-colors flex items-center justify-center bg-muted/40"
        title="İkon seç"
      >
        <Icon icon={currentIcon} width={22} height={22} />
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

          {/* Grid */}
          <div className="overflow-y-auto max-h-[320px] p-2">
            {search.trim() ? (
              <div className="flex flex-wrap gap-1">
                {filtered.map(icon => (
                  <IconButton key={icon.name} icon={icon} selected={value === icon.name}
                    onSelect={n => { onChange(n); setOpen(false) }} />
                ))}
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 w-full text-center">Sonuç bulunamadı</p>
                )}
              </div>
            ) : (
              GROUPS.map(group => {
                const items = NOTO_ICON_LIST.filter(i => i.group === group)
                return (
                  <div key={group} className="mb-3">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">{group}</div>
                    <div className="flex flex-wrap gap-1">
                      {items.map(icon => (
                        <IconButton key={icon.name} icon={icon} selected={value === icon.name}
                          onSelect={n => { onChange(n); setOpen(false) }} />
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
  icon, selected, onSelect,
}: {
  icon: { name: string; label: string }
  selected: boolean
  onSelect: (name: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(icon.name)}
      title={icon.label}
      className={[
        'w-9 h-9 rounded-xl flex items-center justify-center transition-all',
        selected
          ? 'ring-2 ring-primary scale-110 bg-primary/10'
          : 'hover:scale-110 hover:ring-2 hover:ring-border bg-muted/30 hover:bg-muted/60',
      ].join(' ')}
    >
      <Icon icon={icon.name} width={20} height={20} />
    </button>
  )
}
