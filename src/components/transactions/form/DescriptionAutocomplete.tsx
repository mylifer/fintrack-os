'use client'

import { useState, useRef, useMemo, useId } from 'react'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { tagColor, tagKey } from '@/lib/utils/tags'
import { cn } from '@/lib/utils'
import type { Person } from '@/types'
import type { Suggestion } from './form-model'

// ── Autocomplete ──────────────────────────────────────────────────────────────

export function DescriptionAutocomplete({
  value, onChange, onSelect, suggestions, categories, people, accounts, error, autoFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (s: Suggestion) => void
  suggestions: Suggestion[]
  categories: { id: string; name: string; icon: string; color: string }[]
  people: Person[]
  accounts: { id: string; name: string }[]
  error?: string
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const justMountedRef = useRef(true)
  const id = useId()

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter(s => s.description.toLowerCase().includes(q)).slice(0, 6)
  }, [value, suggestions])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || !filtered.length) return
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && filtered[highlighted]) { e.preventDefault(); onSelect(filtered[highlighted]); setOpen(false) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const showDropdown = open && filtered.length > 0

  return (
    <div className="relative">
      <input
        id={id}
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0) }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (justMountedRef.current) { justMountedRef.current = false; return }
          if (value.trim()) setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Migros, Maaş, Kira..."
        aria-invalid={!!error}
        className={cn(
          "h-9 w-full rounded-md border bg-background dark:bg-muted px-3 text-sm outline-none transition-colors",
          "placeholder:text-muted-foreground",
          "focus:ring-2 focus:ring-ring/50 focus:border-ring",
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
          showDropdown && "rounded-b-none border-b-0",
          error ? "border-destructive" : "border-input",
        )}
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-md border border-t-0 border-input bg-popover shadow-md">
          {filtered.map((s, i) => {
            const cat = categories.find(c => c.id === s.categoryId)
            const famPerson = people.find(p => p.id === s.familyMemberId)
            const recPerson = people.find(p => p.id === s.recipientId)
            const toAcc = accounts.find(a => a.id === s.toAccountId)
            return (
              <button
                key={s.description}
                type="button"
                onMouseDown={() => { onSelect(s); setOpen(false) }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                  i === highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <span className="flex-1 truncate">{s.description}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {s.tags?.slice(0, 2).map(t => (
                    <span
                      key={tagKey(t)}
                      className="rounded-md px-1.5 py-0.5 font-medium"
                      style={{ background: `${tagColor(tagKey(t))}1A`, color: tagColor(tagKey(t)) }}
                    >
                      {t}
                    </span>
                  ))}
                  {famPerson && <span>{famPerson.name}</span>}
                  {recPerson && <span>{recPerson.name}</span>}
                  {toAcc && <span>→ {toAcc.name}</span>}
                  {cat && <span className="inline-flex items-center gap-1"><CategoryIcon icon={cat.icon} color={cat.color} size={12} /> {cat.name}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
