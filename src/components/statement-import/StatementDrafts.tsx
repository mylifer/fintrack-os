'use client'

import { rowInWorkspace } from '@/lib/workspace-context'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { IconFileTypePdf, IconTrash } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAccountStore, useWorkspaceStore } from '@/store'
import { useStatementDraftsStore } from '@/store/statement-drafts.store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

/* Yüklenip onaylanmamış ekstreler. Her biri kaldığı yerden açılır; mükerrer
   kontrolü açıldığı anki kayıtlarla yeniden yapılır. Taslaklar yalnız bu
   cihazda saklanır. */

/** Dönem önceki kesimin ertesi günü başlar (özet ekranıyla aynı) */
const nextDay = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10)

const savedAt = (iso: string) => formatDate(iso.slice(0, 10), 'd MMM') + ' ' + new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

export function StatementDrafts() {
  const accounts    = useAccountStore(s => s.accounts)
  const workspaceId = useWorkspaceStore(s => s.activeId)
  const allDrafts   = useStatementDraftsStore(s => s.drafts)
  const remove      = useStatementDraftsStore(s => s.remove)
  const [confirm, setConfirm] = useState<string | null>(null)
  // Başka cihazda başlanan ya da bitirilen ekstreler için bulutla eşitle
  useEffect(() => { const s = useStatementDraftsStore.getState(); s.load(); void s.sync() }, [])

  const drafts = allDrafts.filter(d => !workspaceId || rowInWorkspace(d, workspaceId))

  if (!drafts.length) {
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
      <p className="text-sm text-muted-foreground">
        Onaylanmamış ekstreler. Açtığında satırlar o anki kayıtlarınla yeniden karşılaştırılır; verdiğin kararlar korunur.
        Taslaklar yalnız bu cihazda saklanır.
      </p>
      {drafts.map(d => {
        const st = d.statement
        const account = accounts.find(a => a.id === d.accountId)
        const { review, pending, create } = d.progress
        const decided = review - pending
        return (
          <div key={d.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <IconFileTypePdf className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" stroke={1.5} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold truncate">{st.bankLabel} {st.mapped ? (st.type === 'checking' ? '· hesap dökümü' : '· kart işlemleri') : st.type === 'checking' ? 'vadesiz hesap dökümü' : st.provisional ? 'dönem içi işlemler' : 'kredi kartı ekstresi'}</div>
                <div className="text-xs text-muted-foreground tabular-nums mt-0.5 truncate">
                  {st.account ? `${formatDate(st.account.periodStart, 'd MMM')} – ` : st.prevStatementDate ? `${formatDate(nextDay(st.prevStatementDate), 'd MMM')} – ` : 'Kesim '}{formatDate(st.statementDate, 'd MMM yyyy')}
                  {' · '}{account?.name ?? 'Hesap seçilmedi'}{' · '}{d.fileName}
                </div>
              </div>
              {(st.summary || (st.account && (!st.mapped || st.mapped.hasBalance))) && <div className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatCurrency(st.summary?.debt ?? st.account!.closingBalance)}</div>}
            </div>

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
