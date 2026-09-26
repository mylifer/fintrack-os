'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/Input'
import { useWorkspaceStore } from '@/store'
import { createInviteLink, listMembers, removeMember, type Membership } from '@/lib/sharing'
import type { Workspace } from '@/types'

/* Aile paylaşımı (0021): varsayılan olmayan bir alanı eşinizle paylaşın —
   eşiniz kendi hesabıyla davet bağlantısını açar, ikiniz de aynı hesapları,
   işlemleri ve bütçeleri görür ve düzenlersiniz. */

export function SharingSettings() {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const sharing    = useWorkspaceStore(s => s.sharing)
  const syncSharing = useWorkspaceStore(s => s.syncSharing)
  const add        = useWorkspaceStore(s => s.add)

  const member = workspaces.filter(w => sharing.member.includes(w.id))
  const own    = workspaces.filter(w => !w.isDefault && !sharing.member.includes(w.id))

  const [newName, setNewName] = useState('Aile')
  const [creating, setCreating] = useState(false)

  if (!sharing.available) {
    return (
      <Card>
        <CardContent>
          <Title />
          <p className="text-sm text-muted-foreground">
            Paylaşım için sunucu tarafı hazır değil (0021 migration uygulanmamış).
          </p>
        </CardContent>
      </Card>
    )
  }

  async function createShared(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try { await add(name) } finally { setCreating(false) }
  }

  return (
    <Card>
      <CardContent>
        <Title />
        <p className="text-xs text-muted-foreground mb-4">
          Bir çalışma alanını eşinizle paylaşın: davet bağlantısını kendi hesabıyla açtığında ikiniz de o alandaki
          hesapları, işlemleri, bütçeleri görür ve düzenlersiniz. Varsayılan &quot;Genel&quot; alan paylaşılamaz —
          aile için ayrı bir alan kullanın.
        </p>

        {own.length === 0 ? (
          <form onSubmit={createShared} className="flex items-end gap-2 mb-2">
            <Input label="Paylaşılacak alanın adı" value={newName} onChange={e => setNewName(e.target.value)} className="h-9" />
            <Button type="submit" size="sm" loading={creating} className="rounded-lg h-9 px-3">Alan oluştur</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {own.map(ws => (
              <OwnedWorkspace key={ws.id} ws={ws} shared={sharing.owned.includes(ws.id)} onChanged={syncSharing} />
            ))}
          </div>
        )}

        {member.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">Sizinle paylaşılan</div>
            {member.map(ws => <MemberWorkspace key={ws.id} ws={ws} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Title() {
  return <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-2">Aile Paylaşımı</div>
}

function OwnedWorkspace({ ws, shared, onChanged }: { ws: Workspace; shared: boolean; onChanged: () => Promise<void> }) {
  const [members, setMembers] = useState<Membership[] | null>(null)
  const [link, setLink]       = useState('')
  const [copied, setCopied]   = useState(false)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState('')

  const refresh = useCallback(async () => {
    try { setMembers(await listMembers(ws.id)) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [ws.id])

  useEffect(() => {
    // Paylaşılmamış alanın üyesi yoktur; sorguya gerek yok
    if (!shared) return
    let alive = true
    listMembers(ws.id).then(
      m => { if (alive) setMembers(m) },
      err => { if (alive) setError(err instanceof Error ? err.message : String(err)) },
    )
    return () => { alive = false }
  }, [shared, ws.id])

  async function invite() {
    setBusy('invite'); setError(''); setCopied(false)
    try {
      setLink(await createInviteLink(ws.id, window.location.origin))
      if (!shared) await onChanged()   // ilk davet sahip üyeliğini açar
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch { /* kullanıcı elle kopyalar */ }
  }

  async function remove(m: Membership) {
    if (!window.confirm(`${m.email ?? 'Bu üye'} alandan çıkarılsın mı? Alanın verisine erişimi kalkar.`)) return
    setBusy(m.user_id); setError('')
    try { await removeMember(ws.id, m.user_id); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(null) }
  }

  const others = (members ?? []).filter(m => m.role !== 'owner')

  return (
    <div className="rounded-xl border border-border p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{ws.name}</span>
        {shared && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">Paylaşılıyor</span>}
        <Button size="sm" variant="secondary" className="rounded-lg h-8 px-3" loading={busy === 'invite'} onClick={invite}>
          Davet bağlantısı oluştur
        </Button>
      </div>

      {link && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input readOnly value={link} aria-label="Davet bağlantısı" onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 h-8 rounded-lg border border-border bg-background px-2 text-xs font-mono" />
            <Button size="sm" className="rounded-lg h-8 px-3" onClick={copy}>{copied ? 'Kopyalandı' : 'Kopyala'}</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tek kullanımlık, 7 gün geçerli. Bağlantıyı yalnız eşinize gönderin — açan kişi bu alanın tüm verisini görür.
            Eşiniz önce kendi FinTrack hesabını açmalı.
          </p>
        </div>
      )}

      {others.length > 0 && (
        <ul className="flex flex-col gap-1">
          {others.map(m => (
            <li key={m.user_id} className="flex items-center gap-2 text-sm">
              <span aria-hidden>👤</span>
              <span className="flex-1 min-w-0 truncate">{m.email ?? 'Üye'}</span>
              <button type="button" disabled={!!busy} onClick={() => remove(m)}
                className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50">
                {busy === m.user_id ? 'Çıkarılıyor…' : 'Çıkar'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function MemberWorkspace({ ws }: { ws: Workspace }) {
  const leave = useWorkspaceStore(s => s.leave)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  async function onLeave() {
    if (!window.confirm(`"${ws.name}" alanından ayrılınsın mı? Bu cihazdaki kopyası silinir; veri alanın sahibinde kalır.`)) return
    setBusy(true); setError('')
    try { await leave(ws.id) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden>👥</span>
      <span className="text-sm flex-1 min-w-0 truncate">{ws.name}</span>
      <Button size="sm" variant="secondary" className="rounded-lg h-8 px-3" loading={busy} onClick={onLeave}>Ayrıl</Button>
      {error && <p className="text-xs text-destructive w-full">{error}</p>}
    </div>
  )
}
