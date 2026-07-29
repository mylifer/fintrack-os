'use client'

import { useState, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/store'
import { Input } from '@/components/ui/Input'

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const activeId    = useWorkspaceStore(s => s.activeId)
  const ready        = useWorkspaceStore(s => s.ready)
  const setActive    = useWorkspaceStore(s => s.setActive)
  const add          = useWorkspaceStore(s => s.add)

  const [open, setOpen]           = useState(false)
  const [creating, setCreating]   = useState(false)
  const [name, setName]           = useState('')
  const [switching, setSwitching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
        setName('')
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!ready) return null

  const active = workspaces.find(w => w.id === activeId)

  async function handleSelect(id: string) {
    if (id === activeId) { setOpen(false); return }
    setSwitching(true)
    try {
      await setActive(id)
    } finally {
      setSwitching(false)
      setOpen(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSwitching(true)
    try {
      const ws = await add(trimmed)
      await setActive(ws.id)
    } finally {
      setSwitching(false)
      setCreating(false)
      setName('')
      setOpen(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={switching}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-muted transition-colors disabled:opacity-60"
      >
        <span className="flex-1 min-w-0 truncate text-xs font-semibold text-foreground">
          {switching ? 'Geçiş yapılıyor…' : (active?.name ?? 'Çalışma Alanı')}
        </span>
        <svg
          fill="none" stroke="currentColor" strokeWidth={2}
          viewBox="0 0 24 24" width={13} height={13}
          className="opacity-50 flex-shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[220px] rounded-xl border border-border bg-background shadow-xl overflow-hidden py-1">
          <div className="px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
            Çalışma Alanları
          </div>
          {workspaces.map(ws => (
            <button
              key={ws.id}
              type="button"
              onClick={() => handleSelect(ws.id)}
              className={[
                'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                ws.id === activeId ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              <span className="flex-1 min-w-0 truncate">{ws.name}</span>
              {ws.id === activeId && (
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={14} height={14} className="flex-shrink-0" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>
          ))}

          <div className="border-t border-border mt-1 pt-1">
            {creating ? (
              <form onSubmit={handleCreate} className="px-3 py-1.5 flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Alan adı"
                  className="h-8 text-sm"
                />
                <button
                  type="submit"
                  className="h-8 px-2.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50"
                  disabled={!name.trim()}
                >
                  Ekle
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-muted transition-colors"
              >
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={14} height={14} className="flex-shrink-0" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Yeni Çalışma Alanı
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
