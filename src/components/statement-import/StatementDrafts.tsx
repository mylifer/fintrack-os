'use client'

import { rowInWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAccountStore, useWorkspaceStore } from '@/store'
import { isCommitted, statementKind, useStatementDraftsStore, type StatementKind } from '@/store/statement-drafts.store'
import { useSearchParams } from 'next/navigation'
import { KindTabs } from './StatementHistory'
import { StatementCardHeader } from './StatementCardHeader'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

/* Yüklenip onaylanmamış ekstreler. Her biri kaldığı yerden açılır; mükerrer
   kontrolü açıldığı anki kayıtlarla yeniden yapılır. Taslaklar yalnız bu
   cihazda saklanır. */

const savedAt = (iso: string) => formatDate(iso.slice(0, 10), 'd MMM') + ' ' + new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

export function StatementDrafts() {
  const accounts    = useAccountStore(s => s.accounts)
  const workspaceId = useWorkspaceStore(s => s.activeId)
  const allDrafts   = useStatementDraftsStore(s => s.drafts)
  const remove      = useStatementDraftsStore(s => s.remove)
  const [confirm, setConfirm] = useState<string | null>(null)
  // Başka cihazda başlanan ya da bitirilen ekstreler için bulutla eşitle
  useEffect(() => { const s = useStatementDraftsStore.getState(); s.load(); void s.sync() }, [])

  const searchParams = useSearchParams()
  const open = allDrafts.filter(d => !isCommitted(d) && (!workspaceId || rowInWorkspace(d, workspaceId)))
  const counts = {
    statement: open.filter(d => statementKind(d.statement) === 'statement').length,
    period: open.filter(d => statementKind(d.statement) === 'period').length,
  }
  const tur = searchParams.get('tur')
  const kind: StatementKind = tur === 'donem-ici' ? 'period' : tur === 'ekstre' ? 'statement' : counts.statement || !counts.period ? 'statement' : 'period'
  const drafts = open.filter(d => statementKind(d.statement) === kind)

  if (!open.length) {
    return (
      <div className="max-w-2xl mx-auto w-full rounded-xl border border-border bg-card">
        <EmptyState
          title="Yarım kalan ekstre yok"
          description="Yüklediğin bir ekstreyi onaylamadan kapatırsan burada saklanır; kaldığın yerden devam edersin."
          action={<Link href="/ekstre-yukle" className={buttonVariants({ className: 'rounded-xl' })}>Ekstre yükle</Link>}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-3">
      <KindTabs base="/ekstre-yukle/taslaklar" kind={kind} counts={counts} />
      {!drafts.length && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {kind === 'period' ? 'Yarım kalan dönem içi işlem listesi yok.' : 'Yarım kalan ekstre yok.'}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Onaylanmamış ekstreler. Açtığında satırlar o anki kayıtlarınla yeniden karşılaştırılır; verdiğin kararlar korunur.
        Onayladığın ekstreler <Link href="/ekstre-yukle/yuklenenler" className="text-primary underline-offset-2 hover:underline">Yüklenen Ekstreler</Link>&apos;de.
      </p>
      {drafts.map(d => {
        const account = accounts.find(a => a.id === d.accountId)
        const { review, pending, create } = d.progress
        const decided = review - pending
        return (
          <div key={d.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <StatementCardHeader draft={d} account={account} lines={
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{account?.name ?? 'Hesap seçilmedi'} · {d.fileName}</div>
            } />

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-3 text-xs tabular-nums">
                <span className={cn(pending ? 'text-orange-600 font-medium' : 'text-green-600 font-medium')}>
                  {review === 0 ? 'Karar gereken satır yok' : pending ? `${decided}/${review} karar verildi` : 'Bütün kararlar verildi'}
                </span>
                <span className="text-muted-foreground">{create} kayıt girilecek · son değişiklik {savedAt(d.updatedAt)}</span>
              </div>
              {review > 0 && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(decided / review) * 100}%` }} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/ekstre-yukle?taslak=${d.id}`} className={buttonVariants({ size: 'sm', className: 'rounded-lg' })}>Devam et</Link>
              <span className="flex-1" />
              {confirm === d.id
                ? (
                  <>
                    <span className="text-xs text-muted-foreground">Taslak silinsin mi? Kayıtlarına dokunulmaz.</span>
                    <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setConfirm(null)}>Vazgeç</Button>
                    <Button size="sm" variant="danger" className="rounded-lg" onClick={() => { remove(d.id); setConfirm(null) }}>Sil</Button>
                  </>
                )
                : (
                  <Button size="sm" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => setConfirm(d.id)} aria-label="Taslağı sil">
                    <IconTrash className="size-4" />Sil
                  </Button>
                )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
