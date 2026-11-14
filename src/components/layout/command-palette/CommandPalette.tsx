'use client'

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore, useUIStore } from '@/store'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import type { Account, Category } from '@/types'
import { formatCurrency } from '@/lib/utils/currency'
import { globalSearch, flattenSections, type SearchHit } from '@/lib/utils/globalSearch'
import { ALL_NAV_ITEMS } from '@/components/layout/sidebar/nav'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { useCommandPalette, shortcutLabel } from './useCommandPalette'

/* ── Genel arama / komut paleti (Ctrl+K · ⌘K) ────────────────────────────
   (main) layout'una bir kez takılır. Sayfalar (nav.ts), hesaplar, kategoriler,
   kişiler ve işlemler arasında arar; arama/sıralama mantığı saf olarak
   lib/utils/globalSearch.ts'te. İçerik yalnız açıkken mount edilir: kapalıyken
   store aboneliği ve arama maliyeti yok, her açılış boş sorguyla başlar. */

const PAGES = ALL_NAV_ITEMS.map(i => ({ href: i.href, label: i.label, group: i.group }))
const PAGE_ICON = new Map(ALL_NAV_ITEMS.map(i => [i.href, i.icon]))

export function CommandPalette() {
  const open    = useCommandPalette(s => s.open)
  const setOpen = useCommandPalette(s => s.setOpen)

  // Genel kısayol: Ctrl+K / ⌘K aç-kapa. Yazı alanındayken de çalışır
  // (tarayıcının Ctrl+K'sı adres çubuğu aramasıdır; burada bilinçli eziliyor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useCommandPalette.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 print:hidden data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={[
            'fixed z-[60] inset-x-0 top-0 mx-auto w-full sm:top-[12vh] sm:max-w-xl print:hidden',
            'flex flex-col max-h-[85dvh] sm:max-h-[70vh]',
            'bg-background border border-border shadow-xl rounded-b-2xl sm:rounded-2xl outline-none overflow-hidden',
            'data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-4 duration-150',
          ].join(' ')}
        >
          <DialogPrimitive.Title className="sr-only">Genel arama</DialogPrimitive.Title>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router    = useRouter()
  const openModal = useUIStore(s => s.openModal)

  const accounts     = useAccountStore(s => s.accounts)
  const categories   = useCategoryStore(s => s.categories)
  const people       = usePeopleStore(s => s.people)
  const transactions = useTransactionStore(s => s.transactions)

  const [query, setQuery]   = useState('')
  const [active, setActive] = useState(0)
  // Binlerce işlemde yazarken giriş takılmasın: arama ertelenmiş değerle yapılır.
  const deferred = useDeferredValue(query)

  const sections = useMemo(
    () => globalSearch(deferred, { pages: PAGES, accounts, categories, people, transactions }),
    [deferred, accounts, categories, people, transactions],
  )
  const flat = useMemo(() => flattenSections(sections), [sections])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  // Sorgu değişince seçim başa döner (render sırasında — effect'te bir kare
  // eski indeks çiziliyordu).
  const [prevDeferred, setPrevDeferred] = useState(deferred)
  if (prevDeferred !== deferred) {
    setPrevDeferred(deferred)
    setActive(0)
  }
  const activeIdx = Math.min(active, Math.max(flat.length - 1, 0))

  const baseId   = useId()
  const listId   = `${baseId}-list`
  const optionId = (i: number) => `${baseId}-opt-${i}`
  const listRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return
    onClose()
    if (hit.kind === 'transaction') openModal('edit-transaction', { id: hit.id })
    else if (hit.href) router.push(hit.href)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(i => (flat.length ? (Math.min(i, flat.length - 1) + 1) % flat.length : 0)); break
      case 'ArrowUp':   e.preventDefault(); setActive(i => (flat.length ? (Math.min(i, flat.length - 1) - 1 + flat.length) % flat.length : 0)); break
      case 'Home':      if (flat.length) { e.preventDefault(); setActive(0) } break
      case 'End':       if (flat.length) { e.preventDefault(); setActive(flat.length - 1) } break
      case 'Enter':     e.preventDefault(); choose(flat[activeIdx]); break
    }
  }

  let idx = -1
  return (
    <>
      <div className="flex items-center gap-2 px-4 border-b border-border flex-shrink-0">
        <Icon d={IC.search} size={17} className="text-muted-foreground" />
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-activedescendant={flat.length ? optionId(activeIdx) : undefined}
          aria-autocomplete="list"
          aria-label="Sayfa, hesap, kategori, kişi ya da işlem ara"
          placeholder="Sayfa, hesap, kategori, kişi ya da işlem ara…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="go"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 h-12 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        <DialogPrimitive.Close
          className="text-[11px] font-semibold text-muted-foreground border border-border rounded-md px-1.5 py-0.5 hover:text-foreground"
          aria-label="Aramayı kapat"
        >
          Esc
        </DialogPrimitive.Close>
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label="Arama sonuçları" className="flex-1 min-h-0 overflow-y-auto py-1.5">
        {flat.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground" role="status">
            “{deferred.trim()}” için sonuç yok.
          </div>
        ) : sections.map(section => (
          <div key={section.kind} role="group" aria-labelledby={`${baseId}-${section.kind}`}>
            <div id={`${baseId}-${section.kind}`} className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {section.title}
            </div>
            {section.hits.map(hit => {
              idx += 1
              const i = idx
              const selected = i === activeIdx
              return (
                <div
                  key={hit.key}
                  id={optionId(i)}
                  data-idx={i}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => { if (!selected) setActive(i) }}
                  onClick={() => choose(hit)}
                  className={[
                    'mx-1.5 flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer text-sm',
                    selected ? 'bg-secondary text-foreground' : 'text-foreground/90',
                  ].join(' ')}
                >
                  <HitIcon hit={hit} accById={accById} catById={catById} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{hit.label}</div>
                    {hit.detail && <div className="truncate text-xs text-muted-foreground">{hit.detail}</div>}
                  </div>
                  {hit.tx && (
                    <span className={[
                      'flex-shrink-0 tabular-nums text-xs font-semibold',
                      hit.tx.type === 'income' ? 'text-green-500' : hit.tx.type === 'expense' ? 'text-foreground' : 'text-muted-foreground',
                    ].join(' ')}>
                      {hit.tx.type === 'expense' ? '−' : hit.tx.type === 'income' ? '+' : ''}
                      {formatCurrency(Math.abs(hit.tx.amount), hit.tx.currency)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-muted-foreground flex-shrink-0">
        <span><kbd className="font-sans">↑↓</kbd> gez</span>
        <span><kbd className="font-sans">Enter</kbd> aç</span>
        <span><kbd className="font-sans">Esc</kbd> kapat</span>
        <span className="flex-1" />
        <span>{shortcutLabel()}</span>
      </div>
    </>
  )
}

function HitIcon({ hit, accById, catById }: {
  hit: SearchHit
  accById: Map<string, Account>
  catById: Map<string, Category>
}) {
  const box = 'w-7 h-7 flex items-center justify-center flex-shrink-0 rounded-md bg-secondary/60 text-muted-foreground'
  switch (hit.kind) {
    case 'page':
      return <span className={box}><Icon d={PAGE_ICON.get(hit.id) ?? IC.home} size={15} /></span>
    case 'account': {
      const a = accById.get(hit.id)
      return a ? <span className="w-7 flex justify-center flex-shrink-0"><AccountAvatar account={a} size="xs" /></span> : null
    }
    case 'category': {
      const c = catById.get(hit.id)
      return c ? <span className="w-7 flex justify-center flex-shrink-0"><CategoryIcon icon={c.icon} color={c.color} size={14} /></span> : null
    }
    case 'person':
      return <span className={box}><Icon d={hit.href?.startsWith('/aile') ? IC.family : IC.recipient} size={15} /></span>
    case 'transaction':
      return <span className={box}><Icon d={IC.tx} size={15} /></span>
  }
}
