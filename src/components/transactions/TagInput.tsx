'use client'

import { useMemo, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, Plus, Search, Tag as TagIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dedupeTags, normalizeTag, tagColor, tagKey, type TagAggregate } from '@/lib/utils/tags'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  /** Tüm işlemlerde kullanılan etiketler (kullanım sıklığı sırasıyla). */
  tags: TagAggregate[]
}

interface PoolTag {
  tag: string
  key: string
  count: number
}

// react-remove-scroll in Dialog calls preventDefault() on wheel events for
// portal content rendered outside the Dialog DOM subtree. This bypasses that:
// scrollTop manipulation is not affected by preventDefault().
function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
  e.currentTarget.scrollTop += e.deltaY
}

/** Seçilebilir etiket havuzu: kullanım sıklığı sırası, başta henüz hiçbir
 *  işlemde olmayan (bu formda yeni oluşturulmuş) seçili etiketler. */
function tagPool(tags: readonly TagAggregate[], value: readonly string[]): PoolTag[] {
  const known = new Set(tags.map(t => t.key))
  const fresh = value
    .filter(t => !known.has(tagKey(t)))
    .map(t => ({ tag: t, key: tagKey(t), count: 0 }))
  return [...fresh, ...tags.map(({ tag, key, count }) => ({ tag, key, count }))]
}

/** Sorguyu içerenler; tam eşleşme önce, sonra önek eşleşmesi, sonra geri kalan
 *  (her grup kendi içinde gelen sırayı korur). */
function rankMatches(items: readonly PoolTag[], q: string): PoolTag[] {
  const rank = (k: string) => (k === q ? 0 : k.startsWith(q) ? 1 : 2)
  return items
    .filter(t => t.key.includes(q))
    .map((t, i) => ({ t, i, r: rank(t.key) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.t)
}

/**
 * Etiket seçim paneli. Alan seçili etiketleri gösterir; alana ya da "Ekle"ye
 * tıklamak aranabilir bir panel açar. Her satır işaretlenerek açılıp kapanır
 * ve panel açık kalır (birden fazla seçim tek seferde). Aramayla birebir
 * eşleşmeyen metin için "oluştur" satırı çıkar. Ok tuşları + Enter ile
 * tamamen klavyeden de gider. Panel portal'dadır: kaydırılan form gövdesinde
 * kesilmez. Aynı etiket büyük/küçük harf farkıyla iki kez eklenmez.
 */
export function TagInput({ value, onChange, tags }: Props) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [active, setActive] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value])
  const pool         = useMemo(() => tagPool(tags, value), [tags, value])
  const q            = tagKey(query)
  const norm         = normalizeTag(query)
  const results      = useMemo(() => (q ? rankMatches(pool, q) : pool), [pool, q])
  const canCreate    = !!q && !pool.some(t => t.key === q)
  const rowCount     = results.length + (canCreate ? 1 : 0)

  function remove(key: string) {
    onChange(value.filter(t => tagKey(t) !== key))
  }

  function afterPick() {
    if (query) { setQuery(''); setActive(0) }
    searchRef.current?.focus()
  }

  function toggle(tag: string, key: string) {
    if (selectedKeys.has(key)) remove(key)
    else onChange(dedupeTags([...value, tag]))
    afterPick()
  }

  function create() {
    onChange(dedupeTags([...value, norm]))
    afterPick()
  }

  function activate(i: number) {
    if (i < results.length) toggle(results[i].tag, results[i].key)
    else if (canCreate) create()
  }

  function move(delta: number) {
    const next = Math.max(0, Math.min(rowCount - 1, active + delta))
    setActive(next)
    listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown')    { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter')   { e.preventDefault(); if (rowCount) activate(Math.min(active, rowCount - 1)) }
  }

  return (
    <Popover.Root open={open} onOpenChange={v => { setOpen(v); if (!v) { setQuery(''); setActive(0) } }}>
      <Popover.Anchor asChild>
        <div
          ref={anchorRef}
          onClick={() => setOpen(true)}
          className={cn(
            'flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-sm transition-colors dark:bg-muted',
            open ? 'border-ring ring-2 ring-ring/50' : 'border-input hover:border-foreground/25',
          )}
        >
          {value.map(tag => {
            const key   = tagKey(tag)
            const color = tagColor(key)
            return (
              <span
                key={key}
                className="inline-flex h-6 max-w-[12rem] items-center gap-0.5 rounded-md px-1.5 text-xs font-medium"
                style={{ background: `${color}1A`, color }}
              >
                <span className="opacity-60">#</span>
                <span className="truncate">{tag}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); remove(key) }}
                  className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
                  aria-label={`${tag} etiketini kaldır`}
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground transition-colors hover:text-foreground',
              value.length ? 'text-xs font-medium hover:bg-accent' : 'flex-1 text-sm',
            )}
          >
            {value.length
              ? <><Plus className="size-3.5" />Ekle</>
              : <><TagIcon className="size-3.5" />Etiket seçin ya da oluşturun</>}
          </button>
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          avoidCollisions
          collisionPadding={8}
          onOpenAutoFocus={e => { e.preventDefault(); searchRef.current?.focus() }}
          onCloseAutoFocus={e => e.preventDefault()}
          // Alanın kendisine tıklamak paneli kapatıp yeniden açmasın.
          onInteractOutside={e => { if (anchorRef.current?.contains(e.target as Node)) e.preventDefault() }}
          className={cn(
            'z-[9999] rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          )}
          style={{ width: 'var(--radix-popover-trigger-width)', minWidth: 260 }}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={handleKeyDown}
              placeholder="Etiket ara ya da yeni yaz..."
              aria-label="Etiket ara"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div ref={listRef} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1" onWheel={handleWheel}>
            {results.map((t, i) => {
              const on    = selectedKeys.has(t.key)
              const color = tagColor(t.key)
              return (
                <div
                  key={t.key}
                  data-idx={i}
                  role="option"
                  aria-selected={on}
                  // Odak arama kutusunda kalsın — art arda seçim yazmayı bölmesin.
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => toggle(t.tag, t.key)}
                  className={cn(
                    'flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm select-none',
                    i === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span
                    className="flex size-4 shrink-0 items-center justify-center rounded border"
                    style={on ? { background: color, borderColor: color } : { borderColor: `${color}99` }}
                  >
                    {on && <Check className="size-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{t.tag}</span>
                  {t.count > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground" title={`${t.count} işlemde kullanıldı`}>
                      {t.count}
                    </span>
                  )}
                </div>
              )
            })}
            {canCreate && (
              <div
                data-idx={results.length}
                role="option"
                aria-selected={false}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setActive(results.length)}
                onClick={create}
                className={cn(
                  'flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm select-none',
                  active === results.length && 'bg-accent text-accent-foreground',
                )}
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">&ldquo;{norm}&rdquo; oluştur</span>
              </div>
            )}
            {rowCount === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                Henüz etiket yok — yazıp Enter&apos;a basın
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {value.length ? `${value.length} etiket seçili` : 'Birden fazla seçebilirsiniz'}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Bitti
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
