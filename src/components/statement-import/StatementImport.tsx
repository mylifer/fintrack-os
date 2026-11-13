'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { IconFileTypePdf, IconLoader2, IconCircleCheck, IconAlertTriangle, IconArrowBackUp } from '@tabler/icons-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { SelectField } from '@/components/ui/Select'
import { useAccountStore, useCategoryStore, usePaymentsStore, usePeopleStore, useTransactionStore, useWorkspaceStore } from '@/store'
import { planIdFor } from '@/lib/payments/ids'
import { cardCalendarUpdate, type CalendarUpdate } from '@/lib/statement-import/card-calendar'
import { draftIdFor, useStatementDraftsStore } from '@/store/statement-drafts.store'
import { localBatch, lastPullWasAuthoritative } from '@/lib/sync/engine'
import { foldText } from '@/lib/auto-category'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { readPdfPages } from '@/lib/statement-import/pdf-text'
import { readImageText } from '@/lib/statement-import/ocr'
import { parseScreenshot, parseStatement, type ParsedStatement } from '@/lib/statement-import/statement'
import { buildImportPlan, type ImportPlan, type PlanRow, type RowOption } from '@/lib/statement-import/classify'
import { buildAccountPlan, systemBalance } from '@/lib/statement-import/classify-account'
import { buildCommit, commitEffect, optionForEdit, selectedOption, type RowChoices, type RowEdit } from '@/lib/statement-import/commit'
import { forgetSkipped, loadSkipped, rememberSkipped } from '@/lib/statement-import/skip-memory'
import type { BatchOp } from '@/lib/sync/engine'
import { PreviewList, STATUS_META } from './PreviewList'
import { RowDrawer } from './RowDrawer'

type Step = 'upload' | 'reading' | 'preview' | 'saving' | 'done'

interface DoneState {
  calendar: number
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

// Kart ekstresi kartlara, vadesiz döküm kart dışı hesaplara yüklenir
const accountFits = (a: { type: string; isArchived?: boolean }, st: ParsedStatement | null) =>
  !a.isArchived && (!st || st.type === 'credit_card' ? a.type === 'credit_card' : a.type !== 'credit_card')

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
  const [choices, setChoices]       = useState<RowChoices>({})
  const [edits, setEdits]           = useState<Record<string, RowEdit>>({})
  const [query, setQuery]           = useState('')
  const [openKey, setOpenKey]       = useState<string | null>(null)
  const [dragging, setDragging]     = useState(false)
  const [done, setDone]             = useState<DoneState | null>(null)
  const [undoing, setUndoing]       = useState(false)
  const [offlineOk, setOfflineOk]   = useState(false)
  const [draftId, setDraftId]       = useState<string | null>(null)
  const [applyCalendar, setApplyCalendar] = useState(true)
  const [closedSections, setClosedSections] = useState<Record<string, boolean>>({ exists: true, info: true })
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [showTodo, setShowTodo]     = useState(false)
  const payPlans       = usePaymentsStore(s => s.plans)
  const payOccurrences = usePaymentsStore(s => s.occurrences)

  const router       = useRouter()
  const searchParams = useSearchParams()
  const workspaceId  = useWorkspaceStore(s => s.activeId)
  const drafts       = useStatementDraftsStore(s => s.drafts)
  const saveDraft    = useStatementDraftsStore(s => s.save)
  const removeDraft  = useStatementDraftsStore(s => s.remove)
  useEffect(() => { useStatementDraftsStore.getState().load() }, [])
  const draftCount = drafts.filter(d => d.workspaceId === workspaceId).length

  const candidates = useMemo(() => accounts.filter(a => accountFits(a, statement)), [accounts, statement])
  const account = accounts.find(a => a.id === accountId)

  const makePlan = useCallback((st: ParsedStatement, accId: string, txs = useTransactionStore.getState().transactions): ImportPlan | null => {
    const acc = useAccountStore.getState().accounts.find(a => a.id === accId)
    if (!acc) return null
    return (st.type === 'checking' ? buildAccountPlan : buildImportPlan)({
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

  // Ekstrenin kesim / son ödeme tarihleri → Kart Takvimi (hesap seçiliyse)
  const calendarFor = useCallback((st: ParsedStatement, accId: string): CalendarUpdate | null => {
    const acc = useAccountStore.getState().accounts.find(a => a.id === accId)
    // Dönem içi liste kesim/son ödeme tarihi taşımaz
    if (!acc || acc.type !== 'credit_card' || st.provisional) return null
    const { plans, occurrences } = usePaymentsStore.getState()
    return cardCalendarUpdate({
      statement: st, account: acc, plan: plans.find(p => p.id === planIdFor('card', acc.id)),
      occurrences, nowIso: new Date().toISOString(),
    })
  }, [])
  const calendar = useMemo(() => {
    if (!statement || !accountId) return null
    void accounts; void payPlans; void payOccurrences
    return calendarFor(statement, accountId)
  }, [statement, accountId, accounts, payPlans, payOccurrences, calendarFor])

  // ── Yükleme ──────────────────────────────────────────────────────────────
  async function readFile(file: File) {
    setError('')
    setNotice('')
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    const isImage = /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)
    if (!isPdf && !isImage) {
      setError('PDF ekstre ya da ekran görüntüsü (PNG/JPG) yükleyin. Garanti\'nin Excel dökümünde faiz ve ücret satırları olmadığı için PDF kullanılıyor.')
      return
    }
    setStep('reading')
    try {
      // Mükerrer kontrolü en güncel kayıtlarla yapılsın: önce buluttan çek
      await Promise.all([useTransactionStore.getState().load(), usePeopleStore.getState().load()])
      const st = isPdf
        ? parseStatement(await readPdfPages(await file.arrayBuffer()))
        : parseScreenshot(await readImageText(file))
      // Hesap önerisi: kayıtlarıyla en çok eşleşen hesap (kart ekstresinde kart,
      // vadesiz dökümde kart dışı hesap); eşitlikte adı bankayı içeren
      let best: { id: string; matched: number; byName: boolean } | null = null
      for (const a of useAccountStore.getState().accounts.filter(x => accountFits(x, st))) {
        const p = makePlan(st, a.id)
        const byName = foldText(a.name).includes(st.bank)
        const matched = p?.matchedLines ?? 0
        if (!best || matched > best.matched || (matched === best.matched && byName && !best.byName)) best = { id: a.id, matched, byName }
      }
      const id = draftIdFor(st)
      const prev = useStatementDraftsStore.getState().get(id)
      const prevAccount = prev && useAccountStore.getState().accounts.some(a => a.id === prev.accountId) ? prev.accountId : null
      setStatement(st)
      setFileName(file.name)
      setDraftId(id)
      setAccountId(prevAccount ?? best?.id ?? '')
      setSuggested(best && best.matched > 0 ? { id: best.id, matched: best.matched } : null)
      setChoices(prevAccount ? prev!.choices : {})
      setEdits(prevAccount ? prev!.edits : {})
      if (prevAccount) setNotice('Bu ekstre daha önce yüklenip yarım bırakılmış; verdiğin kararlar geri getirildi.')
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya okunamadı.')
      setStep('upload')
    }
  }

  function reset() {
    setStep('upload'); setStatement(null); setFileName(''); setAccountId(''); setChoices({}); setEdits({})
    setError(''); setNotice(''); setDone(null); setOpenKey(null); setOfflineOk(false); setDraftId(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Yarım kalan ekstre: aç, otomatik kaydet ──────────────────────────────
  const openDraft = useCallback(async (id: string) => {
    // Mükerrer kontrolü taslağın kaydedildiği andaki değil, bugünkü kayıtlarla
    // yapılır. (State güncellemeleri bu beklemeden SONRA: efektten çağrılıyor.)
    await Promise.all([useTransactionStore.getState().load(), usePeopleStore.getState().load()])
    const d = useStatementDraftsStore.getState().get(id)
    setNotice('')
    if (!d) { setError('Bu taslak bulunamadı (silinmiş ya da başka bir cihazda kalmış olabilir).'); return }
    setError('')
    const accountOk = useAccountStore.getState().accounts.some(a => a.id === d.accountId)
    setStatement(d.statement)
    setFileName(d.fileName)
    setDraftId(d.id)
    setAccountId(accountOk ? d.accountId : '')
    setSuggested(null)
    setChoices(accountOk ? d.choices : {})
    setEdits(accountOk ? d.edits : {})
    setStep('preview')
  }, [])

  // /ekstre-yukle?taslak=<id> → taslağı aç, adres çubuğunu temizle
  const draftParam = searchParams.get('taslak')
  useEffect(() => {
    if (!draftParam) return
    router.replace('/ekstre-yukle')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bilinçli: adres çubuğundaki taslağı açar (dış durumla eşitleme); openDraft state'i ancak kayıtlar yüklendikten SONRA, eşzamansız günceller
    void openDraft(draftParam)
  }, [draftParam, openDraft, router])

  // Önizlemedeki her değişiklik taslağa yazılır; içerik değişmediyse yazılmaz
  const lastSaved = useRef('')
  useEffect(() => {
    if (step !== 'preview' || !statement || !draftId || !plan || !preview) return
    const review = plan.rows.filter(r => r.status === 'review')
    const progress = {
      review: review.length,
      pending: review.filter(r => selectedOption(r, choices) === null).length,
      create: preview.createdTxIds.length,
    }
    const sig = JSON.stringify([draftId, accountId, choices, edits, progress])
    if (sig === lastSaved.current) return
    lastSaved.current = sig
    saveDraft({ id: draftId, workspaceId, fileName, statement, accountId, choices, edits, progress })
  }, [step, statement, draftId, accountId, choices, edits, fileName, plan, preview, workspaceId, saveDraft])

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
      // Kart Takvimi değişiklikleri kayıtlarla AYNI işlemde: ya hepsi ya hiçbiri
      const cal = applyCalendar ? calendarFor(statement, accountId) : null
      await localBatch([...res.ops, ...(cal?.ops ?? [])])
      rememberSkipped(accountId, res.skippedKeys)
      if (draftId) removeDraft(draftId)
      await Promise.all([
        useTransactionStore.getState().load(), usePeopleStore.getState().load(),
        ...(cal?.ops.length ? [useAccountStore.getState().load(), usePaymentsStore.getState().load()] : []),
      ])
      useAccountStore.getState().recomputeBalances(useTransactionStore.getState().transactions)
      setDone({
        calendar: cal?.changes.length ?? 0,
        created: res.createdTxIds.length, people: res.createdPeople.length, deleted: res.deletedTxIds.length,
        patched: res.patchedTxIds.length, undo: [...res.undo, ...(cal?.undo ?? [])], skippedKeys: res.skippedKeys, accountId, undone: false,
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
      await Promise.all([
        useTransactionStore.getState().load(), usePeopleStore.getState().load(),
        ...(done.calendar ? [useAccountStore.getState().load(), usePaymentsStore.getState().load()] : []),
      ])
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
        <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f) }} />
        <p className="text-sm text-muted-foreground leading-relaxed">
          Kredi kartı ekstresini ya da vadesiz hesap dökümünü (PDF) yükleyin. Her satır sistemdeki kayıtlarınızla karşılaştırılır; neyin yeni, neyin zaten
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
                  <div className="text-sm font-semibold">Ekstre PDF&apos;ini ya da ekran görüntüsünü seçin</div>
                  <div className="text-xs text-muted-foreground mt-1">veya buraya sürükleyin</div>
                </div>
              </>}
        </div>
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Desteklenen:</span> Garanti BBVA, QNB, Burgan (ON), Yapı Kredi, Odeabank ve Kuveyt Türk kredi kartı ekstresi;
          Garanti BBVA, QNB ve Odeabank dönem içi işlemler (PDF); Kuveyt Türk &quot;Dönem İçi Harcamalar&quot; ekran görüntüsü; Odeabank vadesiz hesap dökümü.
          Dosya yalnız bu tarayıcıda okunur, hiçbir sunucuya gönderilmez. Diğer bankalar örnekleri geldikçe eklenecek.
        </div>
        {draftCount > 0 && step === 'upload' && (
          <Link href="/ekstre-yukle/taslaklar" className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors">
            <span><span className="font-semibold tabular-nums">{draftCount}</span> yarım kalan ekstre var</span>
            <span className="text-primary font-medium">Devam et →</span>
          </Link>
        )}
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
              : <>{done.created} kayıt eklendi{done.people ? `, ${done.people} yeni alıcı` : ''}{done.deleted ? `, ${done.deleted} kayıt silindi` : ''}{done.patched ? `, ${done.patched} kayıt güncellendi (onay / karşı taraf adı)` : ''}{done.calendar ? '; Kart Takvimi güncellendi' : ''}.</>}
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
  // Vadesiz hesap: sistemdeki bakiye (dönem sonu) ve onaydan sonraki hali, bankayla fark
  const balance = statement.account && account && account.type !== 'credit_card' ? (() => {
    const before = systemBalance(account, transactions, statement.account!.periodEnd)
    const after = Math.round((before - effect) * 100) / 100
    return { before, after, diff: Math.round((statement.account!.closingBalance - after) * 100) / 100 }
  })() : null
  const calChanges = calendar?.changes ?? []
  const calValue = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, 'd MMM yyyy') : v ?? '—')

  // Yapılacaklar: karar bekleyen ya da eksik alanı olan satırlar (listedeki sırayla)
  const problemByKey = new Map(problems.map(p => [p.rowKey, p.message]))
  const todo = rows
    .filter(r => r.status === 'review' || problemByKey.has(r.key))
    .map(r => {
      const undecided = r.status === 'review' && selectedOption(r, choices) === null
      const problem = problemByKey.get(r.key) ?? null
      return { row: r, undecided, done: !undecided && !problem, why: undecided ? (r.issue ?? 'Karar bekliyor') : problem }
    })
  const todoDone = todo.filter(t => t.done).length
  const remaining = todo.filter(t => !t.done)

  function jumpTo(row: PlanRow, openDrawer: boolean) {
    setClosedSections(c => ({ ...c, [row.status]: false }))
    setQuery('')
    setHighlightKey(row.key)
    setShowTodo(false)
    if (openDrawer) setOpenKey(row.key)
    window.setTimeout(() => setHighlightKey(k => (k === row.key ? null : k)), 2200)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(`stmt-row-${row.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }))
  }
  // Karar bekleyen satırda seçim listede yapılır; eksik alan için çekmece açılır
  const jumpNext = () => { const t = remaining[0]; if (t) jumpTo(t.row, !t.undecided) }

  // Karar değişince alıcıyı o seçenek belirler ("Yeni alıcıyla gir" / "Alıcısız gir"):
  // çekmecede daha önce yapılan alıcı değişikliği silinir, açıklama ve kategori kalır.
  function choose(key: string, i: number) {
    const row = rows.find(r => r.key === key)
    const opt = row?.options[i]
    if (!row || !opt) return
    setChoices(c => ({ ...c, [key]: opt.key }))
    const prevIdx = selectedOption(row, choices)
    if (prevIdx === i) return
    // Gider ↔ gelir geçişinde seçilmiş kategori öteki türe ait olur: o da silinir
    const typeOf = (o?: RowOption) => { const a = o?.actions.find(x => x.type === 'create'); return a?.type === 'create' ? a.draft.type : undefined }
    const typeChanged = typeOf(prevIdx !== null ? row.options[prevIdx] : undefined) !== typeOf(opt)
    setEdits(e => {
      const cur = e[key]
      if (!cur || (cur.recipientId === undefined && cur.newRecipient === undefined && !(typeChanged && cur.categoryId !== undefined))) return e
      const rest = { ...cur }
      delete rest.recipientId
      delete rest.newRecipient
      if (typeChanged) { delete rest.categoryId; delete rest.categoryAuto }
      return { ...e, [key]: rest }
    })
  }

  // Çekmecede alıcı değişince karar da ona uyar: yeni alıcı yazıldıysa "Yeni alıcıyla
  // gir", var olan seçildiyse "Var olan alıcıyla gir", kaldırıldıysa "Alıcısız gir"
  function editRow(row: PlanRow, patch: RowEdit) {
    const next = { ...edits[row.key], ...patch }
    setEdits(e => ({ ...e, [row.key]: { ...e[row.key], ...patch } }))
    if (!('recipientId' in patch) && !('newRecipient' in patch)) return
    const i = optionForEdit(row, next)
    if (i !== null) setChoices(c => ({ ...c, [row.key]: row.options[i].key }))
  }

  function acceptRecommended() {
    const next = { ...choices }
    for (const r of rows) {
      const rec = r.recommended !== null ? r.options[r.recommended] : undefined
      if (r.status === 'review' && rec && selectedOption(r, next) === null) next[r.key] = rec.key
    }
    setChoices(next)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Başlık + hesap */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{statement.bankLabel} {statement.type === 'checking' ? 'vadesiz hesap dökümü' : statement.provisional ? 'kredi kartı · dönem içi işlemler' : 'kredi kartı ekstresi'}</h2>
          <div className="text-sm text-muted-foreground mt-0.5 tabular-nums">
            {plan ? formatDate(plan.periodStart, 'd MMM') : statement.account ? formatDate(statement.account.periodStart, 'd MMM') : '…'} – {formatDate(statement.statementDate, 'd MMM yyyy')}
            {statement.dueDate && <> · son ödeme {formatDate(statement.dueDate, 'd MMM')}</>} · <span className="break-all">{fileName}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={reset} className="rounded-lg" title="Kararların kaybolmaz; ekstre Yarım Kalanlar'da saklanır">Kapat</Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-semibold">Hesap</span>
        <SelectField
          value={accountId}
          onChange={e => { setAccountId(e.target.value); setChoices({}); setEdits({}) }}
          options={candidates.map(a => ({ value: a.id, label: a.name }))}
          placeholder={statement.type === 'checking' ? 'Hesap seçin' : 'Kart seçin'}
          className="w-56 bg-background"
        />
        {suggested && suggested.id === accountId && (
          <span className="text-sm text-muted-foreground">{suggested.matched} satır bu hesaptaki kayıtlarla eşleşti</span>
        )}
      </div>

      {/* Doğrulama: tek bakışta "tuttu mu", ayrıntı gri */}
      <section className="rounded-xl border border-border bg-card px-4 py-3.5 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-4">
          {statement.check.ok
            ? statement.provisional
              ? <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><IconCircleCheck className="size-4 self-center" />{statement.lines.length} işlem okundu · ekstre henüz kesilmedi, toplam kontrolü yapılamaz</span>
              : <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600"><IconCircleCheck className="size-4 self-center" />{statement.type === 'checking' ? 'Döküm eksiksiz okundu, bakiyeler birebir tuttu' : 'Ekstre bankayla birebir tuttu'}</span>
            : <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive"><IconAlertTriangle className="size-4 self-center" />Ekstre okunamadı</span>}
          {s && <span className="text-lg font-semibold tabular-nums">{formatCurrency(s.debt)}</span>}
          {statement.account && <span className="text-lg font-semibold tabular-nums">{formatCurrency(statement.account.closingBalance)}</span>}
        </div>
        {statement.account && (
          <div className="text-xs text-muted-foreground tabular-nums">
            Dönem başı bakiye {formatCurrency(statement.account.openingBalance)} · {statement.lines.length} hareket · dönem sonu bakiye {formatCurrency(statement.account.closingBalance)}
          </div>
        )}
        {s && (
          <div className="text-xs text-muted-foreground tabular-nums">
            Önceki dönem {formatCurrency(s.previous)} + harcamalar {formatCurrency(s.spending)} + faiz ve ücret {formatCurrency(s.fees)} − ödemeler {formatCurrency(s.payments)}
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
          {balance && (
            <span className="text-muted-foreground tabular-nums" title="Sistemdeki bakiye dönem sonu itibarıyla; takip dışı hareketler (fon alımı, takip edilmeyen hesaplar) farkı açıklayabilir.">
              Sistemde dönem sonu bakiyesi {formatCurrency(balance.before)}{balance.after !== balance.before && <> → onaydan sonra {formatCurrency(balance.after)}</>} · bankayla fark{' '}
              <b className={cn('font-semibold', balance.diff === 0 ? 'text-green-600' : 'text-foreground')}>{formatCurrency(balance.diff)}</b>
            </span>
          )}
          {plan && (
            <span className="text-muted-foreground tabular-nums" title={plan.openingDate ? `Hesabın açılışı ${formatDate(plan.openingDate)}; bundan önceki alımların taksitleri açılış bakiyesinde sayılır.` : undefined}>
              {plan.matchedLines}/{plan.totalLines} satır sistemdeki kayıtlarla eşleşti
            </span>
          )}
        </div>
        {calChanges.length > 0 && (
          <div className="mt-1.5 border-t border-border/60 pt-2.5 flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer w-fit">
              <input type="checkbox" checked={applyCalendar} onChange={e => setApplyCalendar(e.target.checked)} className="accent-primary" />
              Kart Takvimi ekstreye göre güncellensin
            </label>
            <ul className={cn('flex flex-col gap-0.5 text-xs tabular-nums pl-6', !applyCalendar && 'opacity-50')}>
              {calChanges.map(c => (
                <li key={c.label} className="text-muted-foreground">
                  {c.label}: {c.from !== null && <><span className="line-through decoration-muted-foreground/50">{calValue(c.from)}</span> → </>}
                  <span className="text-foreground font-medium">{c.to === null ? 'temizlenir' : calValue(c.to)}</span>
                </li>
              ))}
            </ul>
            <span className="text-[11px] text-muted-foreground pl-6">
              Kayıtlarla birlikte yazılır ve birlikte geri alınır. <Link href="/kart-takvimi" className="underline">Kart Takvimi</Link>
            </span>
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
          query={query}
          onQuery={setQuery}
          onChoose={choose}
          onOpen={setOpenKey}
          openKey={openKey}
          onAcceptRecommended={acceptRecommended}
          closed={closedSections}
          onToggleSection={(sec, open) => setClosedSections(c => ({ ...c, [sec]: open === undefined ? !c[sec] : !open }))}
          highlightKey={highlightKey}
        />
      )}

      <RowDrawer
        row={openRow}
        statement={statement}
        choice={openRow ? selectedOption(openRow, choices) : null}
        edit={openRow ? edits[openRow.key] : undefined}
        onChoose={i => openRow && choose(openRow.key, i)}
        onEdit={patch => openRow && editRow(openRow, patch)}
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
          {todo.length > 0 && (
            <div className="relative flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowTodo(v => !v)}
                aria-expanded={showTodo}
                className="flex items-center gap-2 text-xs tabular-nums rounded-lg px-2 py-1 -mx-2 hover:bg-muted"
                title="Kalanları göster"
              >
                <span className={cn('font-semibold', remaining.length ? 'text-amber-600' : 'text-green-600')}>
                  {remaining.length ? `${todoDone}/${todo.length} tamamlandı · ${remaining.length} kalan` : `${todo.length}/${todo.length} tamamlandı`}
                </span>
                <span className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                  <span className={cn('block h-full rounded-full transition-all', remaining.length ? 'bg-primary' : 'bg-green-600')} style={{ width: `${(todoDone / todo.length) * 100}%` }} />
                </span>
              </button>
              {remaining.length > 0 && (
                <Button size="sm" variant="outline" className="rounded-lg" onClick={jumpNext}>Sıradaki →</Button>
              )}
              {showTodo && remaining.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-[min(22rem,calc(100vw-2rem))] max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg p-1.5">
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">Kalanlar</div>
                  {remaining.map(t => (
                    <button
                      key={t.row.key}
                      type="button"
                      onClick={() => jumpTo(t.row, !t.undecided)}
                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-muted flex items-start gap-2"
                    >
                      <span className={cn('size-2 rounded-full mt-1.5 flex-shrink-0', t.undecided ? 'bg-orange-600' : 'bg-destructive')} />
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{t.row.title}</span>
                          {t.row.amount !== null && <span className="tabular-nums text-muted-foreground whitespace-nowrap">{formatCurrency(t.row.amount)}</span>}
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">{t.why}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {pending === 0 && !problems.length && needsOfflineAck && (
            <span className="text-xs font-semibold text-amber-600">Çevrimdışı uyarısını onaylayın</span>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground flex-1 tabular-nums">
            <span><b className="text-foreground">{preview?.createdTxIds.length ?? 0}</b> kayıt girilecek</span>
            {!!preview?.createdPeople.length && <span><b className="text-foreground">{preview.createdPeople.length}</b> yeni alıcı</span>}
            {!!preview?.deletedTxIds.length && <span><b className="text-foreground">{preview.deletedTxIds.length}</b> kayıt silinecek</span>}
            <span className="hidden sm:inline"><b className="text-foreground">{preview?.patchedTxIds.length ?? 0}</b> kayıt güncellenecek</span>
            {statement.type === 'checking'
              ? <span className="hidden sm:inline">hesaba etkisi <b className="text-foreground">{effect > 0 ? '−' : '+'}{formatCurrency(Math.abs(effect))}</b></span>
              : <span className="hidden sm:inline">karta etkisi <b className="text-foreground">{effect >= 0 ? '+' : '−'}{formatCurrency(Math.abs(effect))}</b> borç</span>}
          </div>
        </div>
      </footer>
    </div>
  )
}

export { STATUS_META }
export type { PlanRow }
