'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/Input'
import { useWorkspaceStore } from '@/store'

export function WorkspaceManager() {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const activeId    = useWorkspaceStore(s => s.activeId)
  const setActive    = useWorkspaceStore(s => s.setActive)
  const add          = useWorkspaceStore(s => s.add)
  const rename        = useWorkspaceStore(s => s.rename)

  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editName, setEditName]       = useState('')
  const [creating, setCreating]       = useState(false)
  const [newName, setNewName]         = useState('')
  const [creatingBusy, setCreatingBusy] = useState(false)

  async function handleSwitch(id: string) {
    if (id === activeId) return
    setSwitchingId(id)
    try {
      await setActive(id)
    } finally {
      setSwitchingId(null)
    }
  }

  function startEdit(id: string, name: string) {
    setEditingId(id)
    setEditName(name)
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId) return
    const trimmed = editName.trim()
    if (trimmed) await rename(editingId, trimmed)
    setEditingId(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    setCreatingBusy(true)
    try {
      const ws = await add(trimmed)
      await setActive(ws.id)
    } finally {
      setCreatingBusy(false)
      setCreating(false)
      setNewName('')
    }
  }

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-4">Çalışma Alanları</div>

        <div className="flex flex-col gap-2">
          {workspaces.map(ws => (
            <div key={ws.id} className="flex items-center gap-3 py-1.5">
              {editingId === ws.id ? (
                <form onSubmit={handleRename} className="flex-1 flex items-center gap-2">
                  <Input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" className="rounded-lg h-8 px-3">Kaydet</Button>
                  <Button type="button" size="sm" variant="secondary" className="rounded-lg h-8 px-3" onClick={() => setEditingId(null)}>
                    İptal
                  </Button>
                </form>
              ) : (
                <>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{ws.name}</span>
                    {ws.id === activeId && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex-shrink-0">
                        Aktif
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-shrink-0 rounded-lg h-8 px-3"
                    onClick={() => startEdit(ws.id, ws.name)}
                  >
                    Yeniden Adlandır
                  </Button>
                  {ws.id !== activeId && (
                    <Button
                      size="sm"
                      className="flex-shrink-0 rounded-lg h-8 px-3"
                      onClick={() => handleSwitch(ws.id)}
                      loading={switchingId === ws.id}
                    >
                      Kullan
                    </Button>
                  )}
                </>
              )}
            </div>
          ))}

          <div className="pt-3 border-t border-border mt-1">
            {creating ? (
              <form onSubmit={handleCreate} className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Alan adı (ör. Şirket Bütçesi)"
                  className="h-9 text-sm flex-1"
                />
                <Button type="submit" size="sm" className="rounded-lg h-9 px-4" loading={creatingBusy} disabled={!newName.trim()}>
                  Ekle
                </Button>
                <Button type="button" size="sm" variant="secondary" className="rounded-lg h-9 px-4" onClick={() => { setCreating(false); setNewName('') }}>
                  İptal
                </Button>
              </form>
            ) : (
              <Button size="sm" variant="secondary" className="rounded-xl px-4 h-9" onClick={() => setCreating(true)}>
                + Yeni Çalışma Alanı
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
