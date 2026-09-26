'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { useWorkspaceStore } from '@/store'
import { acceptInvite } from '@/lib/sharing'

/* Davet bağlantısı: /davet/<token>. Girişsiz açılırsa proxy girişe yollar ve
   girişten sonra buraya döner. Kabul edilince alan aktif yapılır. */

type State = { kind: 'working' } | { kind: 'done'; name: string } | { kind: 'error'; message: string }

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>({ kind: 'working' })
  // StrictMode ve yeniden render'da davet İKİ KEZ tüketilmesin (tek kullanımlık)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        if (!/^[0-9a-f]{64}$/.test(token ?? '')) throw new Error('Bağlantı eksik ya da bozuk.')
        const wsId = await acceptInvite(token)
        const store = useWorkspaceStore.getState()
        await store.load()
        await store.setActive(wsId)
        const name = useWorkspaceStore.getState().workspaces.find(w => w.id === wsId)?.name ?? 'Paylaşılan alan'
        setState({ kind: 'done', name })
      } catch (err) {
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
  }, [token])

  return (
    <>
      <Header title="Davet" />
      <div className="p-6 max-w-lg">
        {state.kind === 'working' && <p className="text-sm text-muted-foreground">Davet kabul ediliyor…</p>}
        {state.kind === 'done' && (
          <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
            <p className="text-sm">
              <span className="font-semibold">{state.name}</span> alanına katıldınız. Artık bu alanın hesaplarını,
              işlemlerini ve bütçelerini görüp düzenleyebilirsiniz; çalışma alanı seçicisinden geçiş yapabilirsiniz.
            </p>
            <Link href="/dashboard" className="self-start px-4 h-9 inline-flex items-center rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
              Ana sayfaya git
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 flex flex-col gap-3">
            <p className="text-sm text-destructive">{state.message}</p>
            <Link href="/dashboard" className="self-start text-sm text-muted-foreground hover:text-foreground">Ana sayfaya dön</Link>
          </div>
        )}
      </div>
    </>
  )
}
