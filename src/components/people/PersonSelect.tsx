'use client'

import { useState, useMemo, useRef } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react'
import { PersonAvatar } from './PersonAvatar'
import { cn } from '@/lib/utils'
import type { Person } from '@/types'

const MAX_H    = 300
const GAP      = 4
const CARD_CLS = 'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10'

const ITEM     = 'flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none transition-colors'
const ITEM_DEF = `${ITEM} hover:bg-accent hover:text-accent-foreground`
const ITEM_ACT = `${ITEM} bg-primary text-primary-foreground`

interface Props {
  people: Person[]
  value: string | null | undefined
  onChange: (id: string | undefined) => void
  placeholder?: string
  /** Aramada sonuç yoksa "yeni ekle" satırı gösterir; yeni kişinin id'sini döndürmeli. */
  onCreate?: (name: string) => Promise<string | null>
}

// react-remove-scroll in Dialog calls preventDefault() on wheel events for
// portal content rendered outside the Dialog DOM subtree. This bypasses that:
// scrollTop manipulation is not affected by preventDefault().
function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget
  el.scrollTop += e.deltaY
}

export function PersonSelect({ people, value, onChange, placeholder, onCreate }: Props) {
  const [open,     setOpen]     = useState(false)
  const [query,    setQuery]    = useState('')
  const [creating, setCreating] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = people.find(p => p.id === value)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(p => p.name.toLowerCase().includes(q))
  }, [query, people])

  function select(id: string | undefined) {
    onChange(id); setOpen(false); setQuery('')
  }

  async function createFromQuery() {
    const name = query.trim()
    if (!name || !onCreate || creating) return
    setCreating(true)
    try {
      const id = await onCreate(name)
      if (id) select(id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={v => { setOpen(v); if (!v) setQuery('') }}>

      {/* ── Trigger ── */}
      <div className="flex gap-1">
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-9 flex-1 min-w-0 items-center justify-between gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none',
              'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              'dark:bg-input/30 border-input data-[state=open]:border-ring',
            )}
          >
            {selected ? (
              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                <PersonAvatar person={selected} size="xs" />
                <span className="truncate">{selected.name}</span>
              </span>
            ) : (
              <span className="flex-1 text-left text-muted-foreground">{placeholder ?? '— Seçin —'}</span>
            )}
            <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        {value && (
          <button
            type="button"
            onClick={() => select(undefined)}
            className="h-9 w-9 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent transition-colors shrink-0"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      {/* ── Portaled content ── */}
      <Popover.Portal>
        <Popover.Content
          sideOffset={GAP}
          align="start"
          avoidCollisions
          onOpenAutoFocus={e => { e.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={e => e.preventDefault()}
          className={[
            'z-[9999] relative',
            CARD_CLS,
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2',
          ].join(' ')}
          style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 220 }}
        >
          {/* Search input */}
          <div style={{ padding: '4px 4px 0' }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ara..."
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 placeholder:text-muted-foreground"
            />
          </div>

          <div style={{ padding: 4, maxHeight: MAX_H, overflowY: 'auto' }} onWheel={handleWheel}>
            {results.length === 0 ? (
              query.trim() && onCreate ? (
                <button
                  type="button"
                  disabled={creating}
                  onClick={createFromQuery}
                  className={cn(ITEM_DEF, 'text-primary disabled:opacity-50')}
                >
                  <PlusIcon className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate text-left">
                    {creating ? 'Ekleniyor...' : <>&ldquo;{query.trim()}&rdquo; ekle</>}
                  </span>
                </button>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">Sonuç bulunamadı</p>
              )
            ) : (
              results.map(p => (
                <div
                  key={p.id}
                  className={p.id === value ? ITEM_ACT : ITEM_DEF}
                  onClick={() => select(p.id)}
                >
                  <PersonAvatar person={p} size="xs" />
                  <span className="flex-1 truncate">{p.name}</span>
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
