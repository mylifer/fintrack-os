'use client'

import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { normalizeTag, tagKey, tagColor } from '@/lib/utils/tags'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  /** Existing tags across all transactions, for autocomplete. */
  suggestions: string[]
}

/**
 * Chip-based multi-select with autocomplete. Users can pick an existing tag
 * from the dropdown or type a new one and press Enter (or comma) to create it.
 * Duplicates are collapsed case-insensitively.
 */
export function TagInput({ value, onChange, suggestions }: Props) {
  const [input, setInput]           = useState('')
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value])

  const filtered = useMemo(() => {
    const q = tagKey(input)
    return suggestions
      .filter(s => !selectedKeys.has(tagKey(s)))
      .filter(s => (q ? tagKey(s).includes(q) : true))
      .slice(0, 8)
  }, [input, suggestions, selectedKeys])

  function addTag(raw: string) {
    const norm = normalizeTag(raw)
    if (!norm) return
    if (selectedKeys.has(tagKey(norm))) { setInput(''); return }
    onChange([...value, norm])
    setInput('')
    setHighlighted(0)
  }

  function removeTag(key: string) {
    onChange(value.filter(t => tagKey(t) !== key))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (open && filtered[highlighted] && input.trim()) addTag(filtered[highlighted])
      else if (input.trim()) addTag(input)
    } else if (e.key === 'ArrowDown' && filtered.length) {
      e.preventDefault(); setOpen(true); setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp' && filtered.length) {
      e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Backspace' && !input && value.length) {
      e.preventDefault(); removeTag(tagKey(value[value.length - 1]))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && filtered.length > 0

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background dark:bg-muted px-2 py-1.5 text-sm transition-colors',
          'focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-ring',
          showDropdown && 'rounded-b-none',
        )}
      >
        {value.map(tag => {
          const key = tagKey(tag)
          return (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
              style={{ background: `${tagColor(key)}1A`, color: tagColor(key) }}
            >
              {tag}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); removeTag(key) }}
                className="opacity-60 hover:opacity-100 transition-opacity"
                aria-label={`${tag} etiketini kaldır`}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setHighlighted(0) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length ? '' : 'Etiket ekleyin...'}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 overflow-hidden rounded-b-md border border-t-0 border-input bg-popover shadow-md">
          {filtered.map((s, i) => {
            const key = tagKey(s)
            return (
              <button
                key={key}
                type="button"
                onMouseDown={() => addTag(s)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  i === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <span className="size-2.5 rounded-sm flex-shrink-0" style={{ background: tagColor(key) }} />
                <span className="truncate">{s}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
