'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkspaceStore } from '@/store/workspace.store'
import { getDefaultWorkspaceId } from '@/lib/workspace-context'
import type { CrossWsPeer } from '@/lib/cross-workspace'

export function crossWsLabel(peer: CrossWsPeer): string {
  return `${peer.direction === 'out' ? '→' : '←'} ${peer.workspaceName} · ${peer.accountName}`
}

export function crossWsTitle(peer: CrossWsPeer): string {
  const where = `"${peer.workspaceName}" alanındaki ${peer.accountName}`
  return `Çalışma alanları arası transfer: para ${where} hesab${peer.direction === 'out' ? 'ına gitti' : 'ından geldi'}. Tıklayınca o hesaba geçilir.`
}

/** Alanlar arası transferin karşı tarafı — tıklayınca karşı alana geçer ve
 *  karşı hesabın sayfasını açar (karşı satır orada, aynı tarihte durur). */
export function CrossWsLink({ peer, className, children }: { peer: CrossWsPeer; className?: string; children?: ReactNode }) {
  const router = useRouter()
  const setActive = useWorkspaceStore(s => s.setActive)
  const [busy, setBusy] = useState(false)

  const go = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busy) return
    const target = peer.workspaceId ?? getDefaultWorkspaceId()
    setBusy(true)
    try {
      if (target) await setActive(target)
      router.push(`/accounts/${peer.accountId}`)
    } catch (err) {
      console.error('[cross-ws:navigate]', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      title={crossWsTitle(peer)}
      className={`min-w-0 text-left transition-colors hover:text-primary disabled:opacity-60 ${className ?? ''}`}
    >
      {children ?? crossWsLabel(peer)}
    </button>
  )
}
