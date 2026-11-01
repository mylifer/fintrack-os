'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState } from 'react'
import { IconFileTypePdf, IconLoader2, IconCircleCheck, IconAlertTriangle, IconArrowBackUp } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { SelectField } from '@/components/ui/Select'
import { useAccountStore, useCategoryStore, usePeopleStore, useTransactionStore } from '@/store'
import { localBatch, lastPullWasAuthoritative } from '@/lib/sync/engine'
import { foldText } from '@/lib/auto-category'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { readPdfPages } from '@/lib/statement-import/pdf-text'
import { parseStatement, type ParsedStatement } from '@/lib/statement-import/statement'
import { buildImportPlan, type ImportPlan, type PlanRow } from '@/lib/statement-import/classify'
import { buildCommit, commitEffect, selectedOption, type RowEdit } from '@/lib/statement-import/commit'
import { forgetSkipped, loadSkipped, rememberSkipped } from '@/lib/statement-import/skip-memory'
import type { BatchOp } from '@/lib/sync/engine'
import { PreviewList, STATUS_META, type StatusFilter } from './PreviewList'
import { RowDrawer } from './RowDrawer'

type Step = 'upload' | 'reading' | 'preview' | 'saving' | 'done'

interface DoneState {
  created: number
  people: number
  deleted: number
  patched: number
  undo: BatchOp[]
  skippedKeys: string[]
  accountId: string
  undone: boolean
}

/** Bütün kayıtlar ve uzak değişiklikler yüklendikten sonra planın imzası:
 *  onay anında yeniden hesaplanan plan farklıysa yazma yapılmaz. */
const planSignature = (p: ImportPlan) => p.rows.map(r => `${r.stableKey}:${r.status}:${r.match?.txIds.join(',') ?? ''}`).join('|')

export function StatementImport() {
  const accounts     = useAccountStore(s => s.accounts)
  const transactions = useTransactionStore(s => s.transactions)
  const people       = usePeopleStore(s => s.people)
  const categories   = useCategoryStore(s => s.categories)

  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep]             = useState<Step>('upload')
  const [error, setError]           = useState('')
  const [notice, setNotice]         = useState('')
  const [fileName, setFileName]     = useState('')
  const [statement, setStatement]   = useState<ParsedStatement | null>(null)
  const [accountId, setAccountId]   = useState('')
  const [suggested, setSuggested]   = useState<{ id: string; matched: number } | null>(null)
  const [choices, setChoices]       = useState<Record<string, number>>({})
  const [edits, setEdits]           = useState<Record<string, RowEdit>>({})
  const [filter, setFilter]         = useState<StatusFilter>('all')
  const [query, setQuery]           = useState('')
  const [openKey, setOpenKey]       = useState<string | null>(null)
  const [dragging, setDragging]     = useState(false)
  const [done, setDone]             = useState<DoneState | null>(null)
  const [undoing, setUndoing]       = useState(false)
  const [offlineOk, setOfflineOk]   = useState(false)

  const cards = useMemo(() => accounts.filter(a => !a.isArchived && a.type === 'credit_card'), [accounts])
  const account = accounts.find(a => a.id === accountId)

  const makePlan = useCallback((st: ParsedStatement, accId: string, txs = useTransactionStore.getState().transactions): ImportPlan | null => {
    const acc = useAccountStore.getState().accounts.find(a => a.id === accId)
    if (!acc) return null
    return buildImportPlan({
      statement: st, account: acc, accounts: useAccountStore.getState().accounts,
      transactions: txs, people: usePeopleStore.getState().people, categories: useCategoryStore.getState().categories,
      todayStr: today(), skipped: loadSkipped(accId),
    })
  }, [])

  // Plan, store'daki her değişiklikte (başka cihazdan gelen kayıt dahil) yeniden hesaplanır
  const plan = useMemo(() => {
    if (!statement || !accountId) return null
    void transactions; void people; void categories
    return makePlan(statement, accountId)
  }, [statement, accountId, transactions, people, categories, makePlan])

  const existing = useMemo(() => new Map(transactions.map(t => [t.id, t])), [transactions])

  const preview = useMemo(() => {
    if (!plan || !accountId) return null
    return buildCommit({
      rows: plan.rows, choices, edits, accountId, existing, people,
      nowIso: new Date().toISOString(), todayStr: today(), newId: () => 'preview',
    })
  }, [plan, choices, edits, accountId, existing, people])

  // ── Yükleme ──────────────────────────────────────────────────────────────
  async function readFile(file: File) {
    setError('')
    setNotice('')
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Şimdilik yalnız PDF ekstre destekleniyor. Garanti\'nin Excel dökümünde faiz ve ücret satırları olmadığı için PDF kullanılıyor.')
      return
    }
    setStep('reading')
    try {
      // Mükerrer kontrolü en güncel kayıtlarla yapılsın: önce buluttan çek
      await Promise.all([useTransactionStore.getState().load(), usePeopleStore.getState().load()])
      const pages = await readPdfPages(await file.arrayBuffer())
      const st = parseStatement(pages)
      // Hesap önerisi: kayıtlarıyla en çok eşleşen kredi kartı; eşitlikte adı bankayı içeren
      let best: { id: string; matched: number; byName: boolean } | null = null
      for (const a of useAccountStore.getState().accounts.filter(x => !x.isArchived && x.type === 'credit_card')) {
        const p = makePlan(st, a.id)
        const byName = foldText(a.name).includes(st.bank)
        const matched = p?.matchedLines ?? 0
        if (!best || matched > best.matched || (matched === best.matched && byName && !best.byName)) best = { id: a.id, matched, byName }
      }
      setStatement(st)
      setFileName(file.name)
      setAccountId(best?.id ?? '')
      setSuggested(best && best.matched > 0 ? { id: best.id, matched: best.matched } : null)
      setChoices({})
      setEdits({})
      setFilter('all')
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya okunamadı.')
      setStep('upload')
    }
  }

  function reset() {
    setStep('upload'); setStatement(null); setFileName(''); setAccountId(''); setChoices({}); setEdits({})
    setError(''); setNotice(''); setDone(null); setOpenKey(null); setOfflineOk(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Onay ─────────────────────────────────────────────────────────────────
  const authoritative = lastPullWasAuthoritative('transactions')

  async function handleCommit() {
    if (!statement || !plan || !accountId) return
    setError('')
    setStep('saving')
    try {
      // Son bir kez buluttan çek ve planı yeniden kur: bu arada başka cihazda
      // girilen bir kayıt varsa önizleme değişir, yazma yapılmaz.
      await useTransactionStore.getState().load()
      const fresh = makePlan(statement, accountId)
      if (!fresh || planSignature(fresh) !== planSignature(plan)) {
        setNotice('Bu arada sistemde değişiklik oldu (başka bir cihazdan kayıt gelmiş olabilir). Önizleme güncellendi; kontrol edip yeniden onaylayın.')
        setStep('preview')
        return
      }
      const txs = useTransactionStore.getState().transactions
      const res = buildCommit({
        rows: fresh.rows, choices, edits, accountId, existing: new Map(txs.map(t => [t.id, t])),
        people: usePeopleStore.getState().people, nowIso: new Date().toISOString(), todayStr: today(),
      })
      if (res.problems.length) {
        setError(`${res.problems.length} satırda eksik var: ${res.problems[0].message}.`)
        setStep('preview')
        return
      }
      await localBatch(res.ops)
      rememberSkipped(accountId, res.skippedKeys)
      await Promise.all([useTransactionStore.getState().load(), usePeopleStore.getState().load()])
      useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)
      setDone({
        created: res.createdTxIds.length, people: res.createdPeople.length, deleted: res.deletedTxIds.length,
        patched: res.patchedTxIds.length, undo: res.undo, skippedKeys: res.skippedKeys, accountId, undone: false,
      })
      setStep('done')
    } catch (err) {
      console.error('[statement-import:commit]', err)
      setError('Kayıt yazılamadı; hiçbir değişiklik yapılmadı. Tekrar deneyin.')
      setStep('preview')
    }
  }

  async function handleUndo() {
    if (!done) return
    setUndoing(true)
    try {
      await localBatch(done.undo)
      forgetSkipped(done.accountId, done.skippedKeys)
      await Promise.all([useTransactionStore.getState().load(), usePeopleStore.getState().load()])
      useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)
      setDone({ ...done, undone: true })
    } finally {
      setUndoing(false)
    }
  }

  // ── Görünüm ──────────────────────────────────────────────────────────────
  if (step === 'upload' || step === 'reading') {
    return (
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f) }} />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Kredi kartı ekstresini (PDF) yükleyin. Her satır sistemdeki kayıtlarınızla karşılaştırılır; neyin yeni, neyin zaten
          girilmiş olduğunu ve karar gereken satırları tek ekranda görürsünüz. Onaylamadan hiçbir şey kaydedilmez.
        </p>
        <div
          role="button" tabIndex={0}
          onClick={() => step === 'upload' && fileRef.current?.click()}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && step === 'upload') { e.preventDefault(); fileRef.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f) }}
          className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl py-14 cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-accent/40' : 'border-border hover:border-primary/50 hover:bg-accent/30'}`}
        >
          {step === 'reading'
            ? <><IconLoader2 className="size-8 animate-spin text-muted-foreground" /><div className="text-sm font-medium">Ekstre okunuyor ve kayıtlarınızla karşılaştırılıyor…</div></>
            : <>
                <IconFileTypePdf className="size-9 text-muted-foreground" stroke={1.5} />
                <div className="text-center">
                  <div className="text-sm font-semibold">Ekstre PDF&apos;ini seçin</div>
                  <div className="text-xs text-muted-foreground mt-1">veya buraya sürükleyin</div>
                </div>
              </>}
        </div>
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Desteklenen:</span> Garanti BBVA kredi kartı ekstresi. PDF yalnız bu
          tarayıcıda okunur, hiçbir sunucuya gönderilmez. Diğer bankalar örnekleri geldikçe eklenecek.
        </div>
        {error && <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">{error}</div>}
      </div>
    )
  }

  if (step === 'done' && done) {
    return (
      <div className="max-w-lg mx-auto w-full flex flex-col items-center gap-5 py-10 text-center">
        {done.undone ? <IconArrowBackUp className="size-12 text-muted-foreground" /> : <IconCircleCheck className="size-12 text-green-600" />}
        <div>
          <div className="text-base font-semibold">{done.undone ? 'Yükleme geri alındı' : 'Ekstre işlendi'}</div>
          <div className="text-sm text-muted-foreground mt-1 tabular-nums">
            {done.undone
              ? 'Bütün değişiklikler geri alındı.'
              : <>{done.created} kayıt eklendi{done.people ? `, ${done.people} yeni alıcı` : ''}{done.deleted ? `, ${done.deleted} kayıt silindi` : ''}{done.patched ? `, ${done.patched} kayıt güncellendi (onay / işyeri adı)` : ''}.</>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          {!done.undone && <Button variant="secondary" onClick={handleUndo} loading={undoing} className="rounded-xl">Geri al</Button>}
          <Button variant="outline" onClick={reset} className="rounded-xl">Başka ekstre yükle</Button>
          {account && <Link href={`/accounts/${account.id}`} className={buttonVariants({ className: 'rounded-xl' })}>{account.name}</Link>}
        </div>
      </div>
    )
  }

  if (!statement) return null

  const rows = plan?.rows ?? []
  const openRow = rows.find(r => r.key === openKey) ?? null
  const reviewKeys = rows.filter(r => r.status === 'review')
  const pending = reviewKeys.filter(r => selectedOption(r, choices) === null).length
  const blockers = plan?.blockers ?? []
  const needsOfflineAck = !authoritative && !offlineOk
  const problems = (preview?.problems ?? []).filter(p => p.message !== 'Karar verilmedi')
  const effect = preview ? commitEffect(preview.ops, accountId, existing) : 0
  const s = statement.summary
  const calendarMismatch = account?.statementDay && +statement.statementDate.slice(8, 10) !== account.statementDay

  function acceptRecommended() {
    const next = { ...choices }
    for (const r of rows) if (r.status === 'review' && next[r.key] === undefined && r.recommended !== null) next[r.key] = r.recommended
    setChoices(next)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Başlık + hesap */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{statement.bankLabel} kredi kartı ekstresi</div>
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            Dönem {plan ? formatDate(plan.periodStart, 'd MMM') : '…'} – {formatDate(statement.statementDate, 'd MMM yyyy')}
            {statement.dueDate && <> · son ödeme {formatDate(statement.dueDate, 'd MMM')}</>} · <span className="break-all">{fileName}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={reset} className="rounded-lg">Vazgeç</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Hesap</span>
        <SelectField
          value={accountId}
          onChange={e => { setAccountId(e.target.value); setChoices({}); setEdits({}) }}
          options={cards.map(a => ({ value: a.id, label: a.name }))}
          placeholder="Kart seçin"
          className="w-56 bg-background"
        />
        {suggested && suggested.id === accountId && (
          <span className="text-xs text-muted-foreground">önerildi: {suggested.matched} satır bu hesaptaki kayıtlarla eşleşti</span>
        )}
      </div>

      {/* Doğrulama */}
      <section className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          {statement.check.ok
            ? <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600"><IconCircleCheck className="size-4" />Ekstre tuttu</span>
            : <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive"><IconAlertTriangle className="size-4" />Ekstre okunamadı</span>}
          {s && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums justify-end">
              <span>Önceki dönem <b className="text-foreground font-semibold">{formatCurrency(s.previous)}</b></span><span>+</span>
              <span>Harcamalar <b className="text-foreground font-semibold">{formatCurrency(s.spending)}</b></span><span>+</span>
              <span>Faiz ve ücret <b className="text-foreground font-semibold">{formatCurrency(s.fees)}</b></span><span>−</span>
              <span>Ödemeler <b className="text-foreground font-semibold">{formatCurrency(s.payments)}</b></span><span>=</span>
              <span>Dönem borcu <b className="text-foreground font-semibold">{formatCurrency(s.debt)}</b></span>
            </div>
          )}
        </div>
        {plan && (
          <div className="text-xs text-muted-foreground tabular-nums">
            Ekstredeki {plan.totalLines} borç/alacak satırından <b className="text-foreground">{plan.matchedLines}</b>&apos;i sistemdeki kayıtlarla eşleşti.
            {plan.openingDate && <> Hesabın açılışı {formatDate(plan.openingDate)}; bundan önceki alımların taksitleri açılış bakiyesinde sayılır.</>}
          </div>
        )}
        {calendarMismatch && (
          <div className="text-xs text-amber-600">
            Ekstreye göre kesim {formatDate(statement.statementDate, 'd MMM')}{statement.dueDate && <>, son ödeme {formatDate(statement.dueDate, 'd MMM')}</>}
            {statement.nextStatementDate && <>; sonraki kesim {formatDate(statement.nextStatementDate, 'd MMM')}</>}. Kartın kesim günü sistemde {account?.statementDay} kayıtlı —{' '}
            <Link href="/kart-takvimi" className="underline">Kart Takvimi&apos;nde</Link> kontrol edin.
          </div>
        )}
      </section>

      {!authoritative && (
        <label className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs">
          <input type="checkbox" checked={offlineOk} onChange={e => setOfflineOk(e.target.checked)} className="mt-0.5 accent-amber-600" />
          <span>Buluttaki en güncel kayıtlar alınamadı (çevrimdışı olabilirsiniz). Başka bir cihazdan girilen kayıtlar mükerrer kontrolünde görünmeyebilir. Yine de devam etmek için işaretleyin.</span>
        </label>
      )}
      {notice && <div className="text-xs font-medium px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">{notice}</div>}
      {error && <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">{error}</div>}

      {plan && (
        <PreviewList
          rows={rows}
          blockers={blockers}
          choices={choices}
          edits={edits}
          categories={categories}
          problems={preview?.problems ?? []}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          onChoose={(key, i) => setChoices(c => ({ ...c, [key]: i }))}
          onOpen={setOpenKey}
          openKey={openKey}
          onAcceptRecommended={acceptRecommended}
        />
      )}

      <RowDrawer
        row={openRow}
        statement={statement}
        choice={openRow ? selectedOption(openRow, choices) : null}
        edit={openRow ? edits[openRow.key] : undefined}
        onChoose={i => openRow && setChoices(c => ({ ...c, [openRow.key]: i }))}
        onEdit={patch => openRow && setEdits(e => ({ ...e, [openRow.key]: { ...e[openRow.key], ...patch } }))}
        onClose={() => setOpenKey(null)}
      />

      {/* Onay çubuğu — düğme solda: sağ alttaki senkron uyarısı (SyncStatusBanner) üstüne binmesin */}
      <footer className="sticky bottom-20 lg:bottom-0 z-20 -mx-4 sm:-mx-6 border-t border-border bg-background/95 backdrop-blur">
        {/* Mobilde sağdaki boşluk hızlı ekle (+) düğmesine yer bırakır */}
        <div className="pl-4 pr-20 sm:pl-6 lg:pr-6 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button
            onClick={handleCommit}
            loading={step === 'saving'}
            disabled={!plan || blockers.length > 0 || pending > 0 || problems.length > 0 || needsOfflineAck || step === 'saving'}
            className="rounded-xl"
          >
            {pending > 0 ? 'Önce kararları verin' : `Onayla ve gir · ${preview?.createdTxIds.length ?? 0} kayıt`}
          </Button>
          {pending > 0 && (
            <span className="text-xs font-semibold text-amber-600">{pending} karar bekliyor</span>
          )}
          {pending === 0 && problems.length > 0 && (
            <span className="text-xs font-semibold text-destructive">{problems.length} satırda eksik var</span>
          )}
          {pending === 0 && !problems.length && needsOfflineAck && (
            <span className="text-xs font-semibold text-amber-600">Çevrimdışı uyarısını onaylayın</span>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground flex-1 tabular-nums">
            <span><b className="text-foreground">{preview?.createdTxIds.length ?? 0}</b> kayıt girilecek</span>
            {!!preview?.createdPeople.length && <span><b className="text-foreground">{preview.createdPeople.length}</b> yeni alıcı</span>}
            {!!preview?.deletedTxIds.length && <span><b className="text-foreground">{preview.deletedTxIds.length}</b> kayıt silinecek</span>}
            <span className="hidden sm:inline"><b className="text-foreground">{preview?.patchedTxIds.length ?? 0}</b> kayıt güncellenecek</span>
            <span className="hidden sm:inline">karta etkisi <b className="text-foreground">{effect >= 0 ? '+' : '−'}{formatCurrency(Math.abs(effect))}</b> borç</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export { STATUS_META }
export type { PlanRow }
