'use client'

import { useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/Select'
import { Checkbox } from '@/components/ui/Checkbox'
import { useAccountStore, useTransactionStore, useCategoryStore } from '@/store'
import { localBulkUpsert } from '@/lib/sync/engine'
import { toBaseTry, rateFor } from '@/lib/utils/fx'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import {
  parseCsvText,
  decodeCsvBytes,
  recordsToParsed,
  autoDetectMapping,
  validateImportRows,
  mappingError,
  findDuplicateRows,
  APP_FIELD_LABELS,
  REQUIRED_FIELDS,
  type ParsedCsv,
  type ColumnMapping,
  type AppField,
  type ImportedTransaction,
  type RowError,
  type SignMode,
} from '@/lib/utils/csv'
import { readXlsxRows, isZip, isLegacyXls } from '@/lib/utils/xlsx'
import type { Account, Transaction } from '@/types'

type Step = 'upload' | 'mapping' | 'preview' | 'done'

interface Props {
  open:    boolean
  onClose: () => void
}

const ALL_FIELDS: AppField[] = ['date', 'description', 'amount', 'debit', 'credit', 'type', 'category', 'currency', 'tags']

/** Kart ekstresinde harcama artı yazılır; banka hesabı dökümünde çıkan eksi. */
function defaultSignMode(account?: Account): SignMode {
  return account?.type === 'credit_card' ? 'positive-expense' : 'negative-expense'
}

export function TransactionImportModal({ open, onClose }: Props) {
  const accounts   = useAccountStore(s => s.accounts)
  const categories = useCategoryStore(s => s.categories)
  const loadTxs    = useTransactionStore(s => s.load)
  const removeMany = useTransactionStore(s => s.removeMany)

  const fileRef  = useRef<HTMLInputElement>(null)
  const [step, setStep]           = useState<Step>('upload')
  const [fileName, setFileName]   = useState('')
  const [parsed, setParsed]       = useState<ParsedCsv | null>(null)
  const [mapping, setMapping]     = useState<ColumnMapping>({})
  const [accountId, setAccountId] = useState('')
  const [signMode, setSignMode]   = useState<SignMode>('negative-expense')
  const [valid, setValid]         = useState<ImportedTransaction[]>([])
  const [dupes, setDupes]         = useState<Set<number>>(new Set())
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [rowErrors, setRowErrors] = useState<RowError[]>([])
  const [showErrors, setShowErrors] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError]         = useState('')
  const [importedIds, setImportedIds] = useState<string[]>([])
  const [undone, setUndone]       = useState(false)
  const [undoing, setUndoing]     = useState(false)
  const [dragging, setDragging]   = useState(false)

  const activeAccounts = accounts.filter(a => !a.isArchived)
  const account = accounts.find(a => a.id === accountId)
  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  // Tek işaretli tutar sütunu (Tür ve Borç/Alacak yok) → işaret yönü sorulur
  const usesSignedAmount = !!mapping.amount && !mapping.type && !mapping.debit && !mapping.credit

  function reset() {
    setStep('upload')
    setFileName('')
    setParsed(null)
    setMapping({})
    setAccountId('')
    setValid([])
    setDupes(new Set())
    setSelected(new Set())
    setRowErrors([])
    setShowErrors(false)
    setImporting(false)
    setError('')
    setImportedIds([])
    setUndone(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  function chooseAccount(id: string) {
    setAccountId(id)
    setSignMode(defaultSignMode(accounts.find(a => a.id === id)))
  }

  // ── Step 1: File upload ─────────────────────────────────────────────────

  async function readFile(file: File) {
    setError('')
    try {
      const bytes = await file.arrayBuffer()
      if (isLegacyXls(bytes)) {
        throw new Error('Eski Excel (.xls) biçimi okunamıyor. Dosyayı Excel\'de açıp "Farklı Kaydet → Excel Çalışma Kitabı (.xlsx)" ya da CSV olarak kaydedin.')
      }
      // xlsx bir ZIP'tir; değilse metin (CSV) — kodlama ve ayraç dosyadan tespit edilir
      const result = isZip(bytes)
        ? recordsToParsed(readXlsxRows(bytes))
        : parseCsvText(decodeCsvBytes(bytes))
      setParsed(result)
      setFileName(file.name)
      setMapping(autoDetectMapping(result.headers))
      chooseAccount(activeAccounts[0]?.id ?? '')
      setStep('mapping')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dosya okunamadı.')
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void readFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void readFile(file)
  }

  // ── Step 2: Validate → önizleme ──────────────────────────────────────────

  function handleValidate() {
    if (!parsed) return
    setError('')

    const mapErr = mappingError(mapping)
    if (mapErr) { setError(mapErr); return }
    if (!accountId) { setError('Lütfen bir hesap seçin.'); return }

    const history = useTransactionStore.getState().transactions
    const result = validateImportRows(parsed.rows, mapping, categories, parsed.rowLines, { signMode, history })
    const dup = findDuplicateRows(result.valid, history.filter(t => t.accountId === accountId))
    setValid(result.valid)
    setDupes(dup)
    // Hesapta zaten olan satırlar işaretsiz gelir: aynı ekstreyi ikinci kez
    // yüklemek veriyi ikiye katlamasın
    setSelected(new Set(result.valid.map((_, i) => i).filter(i => !dup.has(i))))
    setRowErrors(result.errors)
    setShowErrors(false)
    setStep('preview')
  }

  function toggleRow(i: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  function toggleAll() {
    setSelected(prev => prev.size === valid.length ? new Set() : new Set(valid.map((_, i) => i)))
  }

  // ── Step 3: Import ────────────────────────────────────────────────────────

  async function handleImport() {
    const rows = valid.filter((_, i) => selected.has(i))
    if (!rows.length || !accountId) return
    setImporting(true)
    setError('')

    try {
      const now = new Date().toISOString()
      const txs: Transaction[] = rows.map(t => ({
        id:           crypto.randomUUID(),
        type:         t.type,
        amount:       t.amount,
        amountTry:    rateFor(t.currency) != null ? toBaseTry(t.amount, t.currency) : undefined, // snapshot only when rate known (S2/S3, L3)
        currency:     t.currency,
        date:         t.date,
        accountId,
        categoryId:   t.categoryId,
        description:  t.description,
        tags:         t.tags,
        isInstallment: false,
        createdAt:    now,
        updatedAt:    now,
      }))

      // Durable write via the sync engine (C1): Dexie + _outbox in one atomic
      // transaction. Replaces the old raw db.bulkAdd + fire-and-forget insert,
      // which created no outbox entry and could be silently deleted by the next
      // reconciling pull if the cloud write failed (H1).
      await localBulkUpsert('transactions', txs)

      // Safe now: imported rows are pending in the outbox, so reconcilingPull
      // keeps them (offline too) instead of dropping them.
      await loadTxs()

      const { recomputeBalances } = useAccountStore.getState()
      recomputeBalances(useTransactionStore.getState().transactions)

      setImportedIds(txs.map(t => t.id))
      setStep('done')
    } catch (err) {
      setError('İçe aktarma başarısız oldu. Lütfen tekrar deneyin.')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  // Geri al: içe aktarılan satırların hepsi tek seferde silinir (removeMany —
  // o da kendi "geri al" bildirimini gösterir, yani bu adım da geri alınabilir).
  async function handleUndoImport() {
    setUndoing(true)
    try {
      await removeMany(importedIds)
      setUndone(true)
    } finally {
      setUndoing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedCount = selected.size
  const allChecked = valid.length > 0 && selectedCount === valid.length

  return (
    <Modal open={open} onClose={handleClose} title="İşlemleri İçe Aktar" size="lg">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleFile}
        className="hidden"
      />

      {/* ── Upload step ── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bankanızdan indirdiğiniz hesap dökümünü ya da kredi kartı ekstresini yükleyin (CSV ya da Excel .xlsx).
            Sonraki adımda sütunları eşleştirip satırları tek tek gözden geçireceksiniz.
          </p>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl py-12 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-accent/40' : 'border-border hover:border-primary/50 hover:bg-accent/30'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl">
              📂
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold">Dosya seçin</div>
              <div className="text-xs text-muted-foreground mt-1">veya buraya sürükleyin · CSV, Excel (.xlsx)</div>
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Gerekenler:</span> Tarih, Açıklama ve Tutar sütunu
            (ya da ayrı Borç/Alacak sütunları). &quot;Tür&quot; sütunu gerekmez; tutarın işaretinden anlaşılır.
            Tablodan önceki hesap bilgisi satırları otomatik atlanır.
          </div>

          {error && (
            <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Mapping step ── */}
      {step === 'mapping' && parsed && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground min-w-0">
              <span className="font-medium text-foreground break-all">{fileName}</span> ·{' '}
              <span className="font-semibold text-foreground">{parsed.rows.length}</span> satır
            </div>
            <button
              onClick={() => { reset(); fileRef.current?.click() }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              ← Dosyayı değiştir
            </button>
          </div>

          {/* Account selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              Hesap <span className="text-destructive">*</span>
            </label>
            <SelectField
              value={accountId}
              onChange={e => chooseAccount(e.target.value)}
              placeholder="Hesap seçin…"
              options={activeAccounts.map(a => ({ value: a.id, label: a.name }))}
              className="h-10 bg-background"
            />
          </div>

          {/* Column mapping table */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-foreground mb-1">Sütun Eşleştirme</div>
            {ALL_FIELDS.map(field => {
              const isRequired = REQUIRED_FIELDS.includes(field)
              return (
                <div key={field} className="flex items-center gap-3">
                  <div className="w-44 flex-shrink-0">
                    <span className="text-xs font-medium text-foreground">
                      {APP_FIELD_LABELS[field]}
                    </span>
                    {isRequired && <span className="text-destructive ml-1 text-xs">*</span>}
                  </div>
                  <SelectField
                    value={mapping[field] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, [field]: e.target.value || undefined }))}
                    options={[
                      { value: '', label: isRequired ? 'Sütun seçin…' : 'Yok (atla)' },
                      ...parsed.headers.map(h => ({ value: h, label: h })),
                    ]}
                    className="flex-1 bg-background text-xs"
                  />
                </div>
              )
            })}
            <div className="text-[11px] text-muted-foreground">
              Tutar için ya &quot;Tutar&quot; sütununu ya da &quot;Borç/Alacak&quot; sütunlarını seçin.
              Borç/Alacak seçiliyse Tutar yok sayılır.
            </div>
          </div>

          {usesSignedAmount && (
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <div className="text-xs font-semibold text-foreground">Tutarın işareti ne anlama geliyor?</div>
              {([
                ['negative-expense', 'Eksi tutar gider', 'Banka hesabı dökümü: çıkan para eksi, giren para artı yazılır.'],
                ['positive-expense', 'Artı tutar gider', 'Kredi kartı ekstresi: harcamalar artı, karta ödemeler ve iadeler eksi yazılır.'],
              ] as const).map(([value, label, hint]) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="sign-mode"
                    checked={signMode === value}
                    onChange={() => setSignMode(value)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm">{label}</span>
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Preview row */}
          {parsed.rows[0] && (
            <div className="rounded-xl bg-muted/40 p-3 flex flex-col gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">İlk Satır</div>
              {ALL_FIELDS.filter(f => mapping[f]).map(f => (
                <div key={f} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground w-32 flex-shrink-0">{APP_FIELD_LABELS[f].replace(' (opsiyonel)', '')}:</span>
                  <span className="text-foreground font-medium truncate">{parsed.rows[0][mapping[f]!] || '–'}</span>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={handleClose} className="flex-1 rounded-xl">İptal</Button>
            <Button onClick={handleValidate} className="flex-1 rounded-xl">Önizle →</Button>
          </div>
        </div>
      )}

      {/* ── Preview step ── */}
      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{selectedCount}</span> / {valid.length} satır seçili</span>
            {dupes.size > 0 && <span>{dupes.size} satır hesapta zaten var (işaretsiz)</span>}
            {rowErrors.length > 0 && (
              <button type="button" onClick={() => setShowErrors(s => !s)} className="text-destructive hover:underline">
                {rowErrors.length} satır okunamadı {showErrors ? '▲' : '▼'}
              </button>
            )}
          </div>

          {account?.type === 'credit_card' && (
            <div className="text-xs text-muted-foreground rounded-xl bg-muted/40 px-3 py-2">
              Karta yapılan ödemeleri banka hesabından transfer olarak zaten giriyorsanız o satırların işaretini kaldırın.
            </div>
          )}

          {showErrors && rowErrors.length > 0 && (
            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              {rowErrors.map(e => (
                <div key={e.row} className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Satır {e.row}:</span> {e.message}
                </div>
              ))}
            </div>
          )}

          {valid.length === 0 ? (
            <div className="text-sm text-center text-muted-foreground py-4">
              İçe aktarılacak geçerli satır yok. Eşleştirmeyi düzeltin.
            </div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="w-8 px-2 py-2">
                      <Checkbox
                        checked={allChecked}
                        indeterminate={selectedCount > 0 && !allChecked}
                        onChange={toggleAll}
                        aria-label="Tümünü seç"
                      />
                    </th>
                    <th className="px-2 py-2 text-left font-medium">Tarih</th>
                    <th className="px-2 py-2 text-left font-medium">Açıklama</th>
                    <th className="px-2 py-2 text-left font-medium">Kategori</th>
                    <th className="px-2 py-2 text-right font-medium">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {valid.map((t, i) => (
                    <tr
                      key={`${t.row}-${i}`}
                      className={`border-b border-border/50 last:border-0 ${selected.has(i) ? '' : 'opacity-50'}`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <Checkbox checked={selected.has(i)} onChange={() => toggleRow(i)} aria-label={`Satır ${t.row}`} />
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{formatDate(t.date, 'd MMM yy')}</td>
                      <td className="px-2 py-1.5 max-w-56">
                        <div className="truncate" title={t.description}>{t.description}</div>
                        {dupes.has(i) && <div className="text-[10px] text-amber-600">Hesapta zaten var</div>}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-32">
                        {t.categoryId ? catName.get(t.categoryId) ?? '—' : '—'}
                      </td>
                      <td className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums font-medium ${
                        t.type === 'income' ? 'text-green-600' : 'text-destructive'
                      }`}>
                        {t.type === 'income' ? '+' : '−'}{formatCurrency(Math.abs(t.amount), t.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={() => setStep('mapping')} className="flex-1 rounded-xl">
              ← Geri
            </Button>
            <Button
              onClick={handleImport}
              disabled={selectedCount === 0 || importing}
              loading={importing}
              className="flex-1 rounded-xl"
            >
              {selectedCount} İşlemi İçe Aktar
            </Button>
          </div>
        </div>
      )}

      {/* ── Done step ── */}
      {step === 'done' && (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-600/10 flex items-center justify-center text-3xl">
            {undone ? '↩️' : '✅'}
          </div>
          <div>
            <div className="text-base font-semibold">
              {undone ? 'İçe Aktarma Geri Alındı' : 'İçe Aktarma Tamamlandı'}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {undone
                ? <><span className="font-semibold text-foreground">{importedIds.length}</span> işlem silindi.</>
                : <><span className="font-semibold text-foreground">{importedIds.length}</span> işlem eklendi.</>}
            </div>
          </div>
          <div className="flex gap-2">
            {!undone && (
              <Button variant="secondary" onClick={handleUndoImport} loading={undoing} className="px-5 rounded-xl">
                Geri Al
              </Button>
            )}
            <Button onClick={handleClose} className="px-8 rounded-xl">Kapat</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
