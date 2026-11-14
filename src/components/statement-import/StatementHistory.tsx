'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { IconArrowLeft, IconFileTypePdf, IconSearch, IconTrash } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { TransactionList } from '@/components/transactions/TransactionList'
import { BatchEditDrawer } from '@/components/transactions/BatchEditDrawer'
import { useTxSelection } from '@/lib/hooks/useTxSelection'
import { useAccountStore, usePeopleStore, useTransactionStore, useWorkspaceStore } from '@/store'
import { isCommitted, statementKind, useStatementDraftsStore, type StatementDraft, type StatementKind } from '@/store/statement-drafts.store'
import { rowInWorkspace } from '@/lib/workspace-context'
import { foldText } from '@/lib/auto-category'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import type { Transaction } from '@/types'

/* ── Yüklenen (onaylanmış) ekstreler ─────────────────────────────────────────
   Onaylanan ekstre silinmez: dönemi, hesabı ve onayda girilen işlemlerin
   kimlikleriyle saklanır (statement-drafts.store, committedAt). Buradan bir
   ekstre açılınca o ekstrede girilen işlemler ve ekstrenin dönemindeki bütün
   işlemler listelenir; satıra tıklayınca işlem düzenleme penceresi açılır,
   birden çok satır seçilip toplu düzenlenebilir. "Yeniden karşılaştır" ekstreyi
   bugünkü kayıtlarla tekrar açar (eksik kalan satır varsa girilebilir). */

/** Dönem önceki kesimin ertesi günü başlar (özet ekranıyla aynı) */
const nextDay = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10)

const stamp = (iso: string) => formatDate(iso.slice(0, 10), 'd MMM yyyy') + ' ' + new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

/** Ekstrenin kapsadığı tarih aralığı: vadesiz dökümde dönem, kartta önceki
 *  kesimin ertesi → kesim; satır tarihleri aralığın dışına taşıyorsa genişletilir. */
export function statementRange(d: Pick<StatementDraft, 'statement'>): { start: string; end: string } {
  const st = d.statement
  const dates = st.lines.map(l => l.date).filter((x): x is string => !!x).sort()
  let start = st.account?.periodStart ?? (st.prevStatementDate ? nextDay(st.prevStatementDate) : dates[0] ?? st.statementDate)
  let end = st.account?.periodEnd ?? st.statementDate
  if (dates.length) {
    if (dates[0] < start) start = dates[0]
    if (dates[dates.length - 1] > end) end = dates[dates.length - 1]
  }
  return { start, end }
}

function statementTitle(d: StatementDraft): string {
  const st = d.statement
  return `${st.bankLabel} ${st.mapped ? (st.type === 'checking' ? '· hesap dökümü' : '· kart işlemleri') : st.type === 'checking' ? 'vadesiz hesap dökümü' : st.provisional ? 'dönem içi işlemler' : 'kredi kartı ekstresi'}`
}

export function StatementHistory() {
  const workspaceId = useWorkspaceStore(s => s.activeId)
  const allDrafts   = useStatementDraftsStore(s => s.drafts)
  const searchParams = useSearchParams()
  const openId = searchParams.get('ekstre')
  const kindParam: StatementKind | null = searchParams.get('tur') === 'donem-ici' ? 'period' : searchParams.get('tur') === 'ekstre' ? 'statement' : null
  // Başka cihazda onaylanan ekstreler için bulutla eşitle
  useEffect(() => { const s = useStatementDraftsStore.getState(); s.load(); void s.sync() }, [])

  const list = allDrafts
    .filter(d => isCommitted(d) && (!workspaceId || rowInWorkspace(d, workspaceId)))
    .sort((a, b) => b.statement.statementDate.localeCompare(a.statement.statementDate) || b.committedAt!.localeCompare(a.committedAt!))

  const open = openId ? list.find(d => d.id === openId) : undefined
  if (openId && open) return <StatementDetail draft={open} />
  // Sekme: adresteki tür, yoksa ekstre (ekstre yoksa dönem içi)
  const kind = kindParam ?? (list.some(d => statementKind(d.statement) === 'statement') || !list.length ? 'statement' : 'period')
  return <StatementIndex list={list} kind={kind} missing={!!openId} />
}

export const KIND_LABEL: Record<StatementKind, string> = { statement: 'Ekstreler', period: 'Dönem içi işlemler' }
const kindParamOf = (k: StatementKind) => (k === 'period' ? 'donem-ici' : 'ekstre')

/** Ekstreler / Dönem içi işlemler sekmeleri (bağlantı: sekme adreste kalır) */
export function KindTabs({ base, kind, counts }: { base: string; kind: StatementKind; counts: Record<StatementKind, number> }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 w-full sm:w-fit" role="tablist">
      {(['statement', 'period'] as const).map(k => (
        <Link key={k} href={`${base}?tur=${kindParamOf(k)}`} role="tab" aria-selected={kind === k} replace
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium text-center transition-all whitespace-nowrap',
            kind === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {KIND_LABEL[k]} <span className="tabular-nums text-muted-foreground font-normal">{counts[k]}</span>
        </Link>
      ))}
    </div>
  )
}

function StatementIndex({ list: all, kind, missing }: { list: StatementDraft[]; kind: StatementKind; missing: boolean }) {
  const accounts = useAccountStore(s => s.accounts)
  const remove   = useStatementDraftsStore(s => s.remove)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [accountFilter, setAccountFilter] = useState('')
  const counts = {
    statement: all.filter(d => statementKind(d.statement) === 'statement').length,
    period: all.filter(d => statementKind(d.statement) === 'period').length,
  }
  const list = all.filter(d => statementKind(d.statement) === kind)

  const usedAccounts = [...new Set(list.map(d => d.accountId))]
    .map(id => accounts.find(a => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a)
  const shown = accountFilter ? list.filter(d => d.accountId === accountFilter) : list

  if (!all.length) {
    return (
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-3">
        {missing && <div className="text-xs font-medium px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">Bu ekstre bulunamadı (listeden kaldırılmış ya da başka bir çalışma alanına ait olabilir).</div>}
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            title="Yüklenmiş ekstre yok"
            description="Onayladığın ekstreler burada dönemiyle birlikte saklanır; açıp o dönemin işlemlerini düzenleyebilirsin."
            action={<Link href="/ekstre-yukle" className={buttonVariants({ className: 'rounded-xl' })}>Ekstre yükle</Link>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-3">
      {missing && <div className="text-xs font-medium px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">Bu ekstre bulunamadı (listeden kaldırılmış ya da başka bir çalışma alanına ait olabilir).</div>}
      <KindTabs base="/ekstre-yukle/yuklenenler" kind={kind} counts={counts} />
      <p className="text-sm text-muted-foreground">
        {kind === 'period'
          ? 'Onayladığın dönem içi işlem listeleri (ekstresi henüz kesilmemiş harcamalar). Ekstreler ayrı sekmede.'
          : 'Onayladığın kart ekstreleri ve hesap dökümleri.'}
        {' '}Birini açınca ondan girilen işlemleri ve dönemdeki bütün işlemleri görür, düzenlersin.
      </p>
      {!list.length && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {kind === 'period' ? 'Onaylanmış dönem içi işlem listesi yok.' : 'Onaylanmış ekstre yok.'}
        </div>
      )}
      {usedAccounts.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: '', name: 'Tümü' }, ...usedAccounts].map(a => (
            <button key={a.id} type="button" onClick={() => setAccountFilter(a.id)}
              className={cn('rounded-lg border px-2.5 py-1 text-xs transition-colors',
                accountFilter === a.id ? 'border-primary bg-primary/10 text-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted/50')}>
              {a.name}
            </button>
          ))}
        </div>
      )}
      {shown.map(d => {
        const st = d.statement
        const account = accounts.find(a => a.id === d.accountId)
        const { start, end } = statementRange(d)
        const created = d.createdTxIds?.length ?? 0
        return (
          <div key={d.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
            <Link href={`/ekstre-yukle/yuklenenler?ekstre=${d.id}`} className="flex items-start gap-3 group">
              <IconFileTypePdf className="size-5 text-muted-foreground flex-shrink-0 mt-0.5" stroke={1.5} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold truncate group-hover:underline underline-offset-2">{statementTitle(d)}</div>
                <div className="text-xs text-muted-foreground tabular-nums mt-0.5 truncate">
                  {formatDate(start, 'd MMM')} – {formatDate(end, 'd MMM yyyy')} · {account?.name ?? 'Hesap bulunamadı'} · {d.fileName}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  {st.lines.length} satır · {created} kayıt girildi · onay {stamp(d.committedAt!)}
                </div>
              </div>
              {(st.summary || (st.account && (!st.mapped || st.mapped.hasBalance))) && <div className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatCurrency(st.summary?.debt ?? st.account!.closingBalance)}</div>}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/ekstre-yukle/yuklenenler?ekstre=${d.id}`} className={buttonVariants({ size: 'sm', className: 'rounded-lg' })}>İşlemleri aç</Link>
              <Link href={`/ekstre-yukle?taslak=${d.id}`} className={buttonVariants({ size: 'sm', variant: 'outline', className: 'rounded-lg' })} title="Ekstreyi bugünkü kayıtlarla yeniden karşılaştırır">Yeniden karşılaştır</Link>
              <span className="flex-1" />
              {confirm === d.id
                ? (
                  <>
                    <span className="text-xs text-muted-foreground">Listeden kaldırılsın mı? İşlemlerine dokunulmaz.</span>
                    <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setConfirm(null)}>Vazgeç</Button>
                    <Button size="sm" variant="danger" className="rounded-lg" onClick={() => { remove(d.id); setConfirm(null) }}>Kaldır</Button>
                  </>
                )
                : (
                  <Button size="sm" variant="ghost" className="rounded-lg text-muted-foreground" onClick={() => setConfirm(d.id)} aria-label="Listeden kaldır">
                    <IconTrash className="size-4" />Kaldır
                  </Button>
                )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

type Scope = 'created' | 'period'

function StatementDetail({ draft }: { draft: StatementDraft }) {
  const accounts     = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)
  const people       = usePeopleStore(s => s.people)
  const account = accounts.find(a => a.id === draft.accountId)
  const { start, end } = statementRange(draft)
  const createdIds = useMemo(() => new Set(draft.createdTxIds ?? []), [draft.createdTxIds])
  const [scope, setScope] = useState<Scope>(createdIds.size ? 'created' : 'period')
  const [query, setQuery] = useState('')
  const sel = useTxSelection(`${draft.id}:${scope}`)

  const live = useMemo(() => transactions.filter(t => !t.deleted_at), [transactions])
  const created = useMemo(() => live.filter(t => createdIds.has(t.id)), [live, createdIds])
  const period = useMemo(() => live.filter(t =>
    (t.accountId === draft.accountId || t.toAccountId === draft.accountId) && t.date >= start && t.date <= end,
  ), [live, draft.accountId, start, end])

  const personName = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people])
  const base = scope === 'created' ? created : period
  const q = foldText(query.trim())
  const shown: Transaction[] = q
    ? base.filter(t => foldText([t.description, t.merchant ?? '', t.recipientId ? personName.get(t.recipientId) ?? '' : '', String(t.amount).replace('.', ',')].join(' ')).includes(q))
    : base

  const st = draft.statement
  const tabs: [Scope, string, number][] = [
    ['created', 'Bu ekstreden girilenler', created.length],
    ['period', 'Dönemdeki tüm işlemler', period.length],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/ekstre-yukle/yuklenenler?tur=${kindParamOf(statementKind(draft.statement))}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <IconArrowLeft className="size-4" />{KIND_LABEL[statementKind(draft.statement)]}
          </Link>
          <h2 className="text-xl font-semibold tracking-tight mt-1">{statementTitle(draft)}</h2>
          <div className="text-sm text-muted-foreground mt-0.5 tabular-nums">
            {formatDate(start, 'd MMM')} – {formatDate(end, 'd MMM yyyy')}
            {st.dueDate && <> · son ödeme {formatDate(st.dueDate, 'd MMM')}</>}
            {' · '}{account ? <Link href={`/accounts/${account.id}`} className="hover:underline underline-offset-2">{account.name}</Link> : 'Hesap bulunamadı'}
            {' · '}<span className="break-all">{draft.fileName}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">Onaylandı: {stamp(draft.committedAt!)}</div>
        </div>
        <div className="flex gap-2">
          <Link href={`/ekstre-yukle?taslak=${draft.id}`} className={buttonVariants({ size: 'sm', variant: 'outline', className: 'rounded-lg' })} title="Ekstreyi bugünkü kayıtlarla yeniden karşılaştırır; eksik satır varsa girebilirsin">
            Yeniden karşılaştır
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
          {tabs.map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={scope === key} onClick={() => setScope(key)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-all whitespace-nowrap',
                scope === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {label} <span className="tabular-nums text-muted-foreground font-normal">{n}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Açıklama, işyeri, alıcı ya da tutar ara"
            className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>
      {scope === 'created' && !createdIds.size && (
        <div className="text-xs text-muted-foreground">Bu ekstrenin onayında yeni kayıt girilmedi; satırların hepsi zaten sistemdeydi. Dönemdeki işlemlere bakabilirsin.</div>
      )}

      <TransactionList
        transactions={shown}
        layout="table"
        showAccount={scope === 'created' || !account}
        primaryAccountId={scope === 'period' ? draft.accountId : undefined}
        emptyTitle="İşlem bulunamadı"
        emptyDescription={q ? 'Aramayla eşleşen işlem yok.' : scope === 'created' ? 'Bu ekstreden girilen işlemler silinmiş olabilir.' : 'Bu dönemde bu hesapta işlem yok.'}
        selectable
        selectedIds={sel.selectedIds}
        onToggleSelect={sel.toggle}
        onSelectMany={sel.selectMany}
      />

      <BatchEditDrawer selectedIds={sel.list} onClose={sel.clear} />
    </div>
  )
}
