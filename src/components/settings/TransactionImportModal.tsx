'use client'

import { useState, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { useAccountStore, useTransactionStore, useCategoryStore } from '@/store'
import { localBulkUpsert } from '@/lib/sync/engine'
import { toBaseTry } from '@/lib/utils/fx'
import {
  parseCsvText,
  autoDetectMapping,
  validateImportRows,
  APP_FIELD_LABELS,
  REQUIRED_FIELDS,
  type ParsedCsv,
  type ColumnMapping,
  type AppField,
  type ImportedTransaction,
} from '@/lib/utils/csv'
import type { Transaction } from '@/types'

type Step = 'upload' | 'mapping' | 'validate' | 'done'

interface Props {
  open:    boolean
  onClose: () => void
}

const ALL_FIELDS: AppField[] = ['date', 'description', 'amount', 'type', 'category', 'currency', 'tags']

export function TransactionImportModal({ open, onClose }: Props) {
  const accounts   = useAccountStore(s => s.accounts)
  const categories = useCategoryStore(s => s.categories)
  const loadTxs    = useTransactionStore(s => s.load)

  const fileRef  = useRef<HTMLInputElement>(null)
  const [step, setStep]           = useState<Step>('upload')
  const [parsed, setParsed]       = useState<ParsedCsv | null>(null)
  const [mapping, setMapping]     = useState<ColumnMapping>({})
  const [accountId, setAccountId] = useState('')
  const [valid, setValid]         = useState<ImportedTransaction[]>([])
  const [rowErrors, setRowErrors] = useState<{ row: number; message: string }[]>([])
  const [importing, setImporting] = useState(false)
  const [error, setError]         = useState('')
  const [importedCount, setImportedCount] = useState(0)
  const [skippedDup, setSkippedDup]       = useState(0)

  const activeAccounts = accounts.filter(a => !a.isArchived)

  function reset() {
    setStep('upload')
    setParsed(null)
    setMapping({})
    setAccountId('')
    setValid([])
    setRowErrors([])
    setImporting(false)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ── Step 1: File upload ─────────────────────────────────────────────────

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError('')
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const result = parseCsvText(ev.target?.result as string)
        const detected = autoDetectMapping(result.headers)
        setParsed(result)
        setMapping(detected)
        setAccountId(activeAccounts[0]?.id ?? '')
        setStep('mapping')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dosya okunamadı.')
      }
    }
    reader.onerror = () => setError('Dosya okunamadı.')
    reader.readAsText(file, 'UTF-8')
  }

  // ── Step 2: Validate ─────────────────────────────────────────────────────

  function handleValidate() {
    if (!parsed) return
    setError('')

    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field]) {
        setError(`"${APP_FIELD_LABELS[field]}" alanı için bir sütun seçmelisiniz.`)
        return
      }
    }
    if (!accountId) {
      setError('Lütfen bir hesap seçin.')
      return
    }

    const result = validateImportRows(parsed.rows, mapping, categories, parsed.rowLines)
    setValid(result.valid)
    setRowErrors(result.errors)
    setStep('validate')
  }

  // ── Step 3: Import ────────────────────────────────────────────────────────

  async function handleImport() {
    if (!valid.length || !accountId) return
    setImporting(true)
    setError('')

    try {
      const now = new Date().toISOString()

      // Duplicate guard (M5): skip rows that match an existing transaction in the
      // target account (date + amount + description) and de-dupe within the file,
      // so re-importing the same statement can't double the data.
      const sig = (date: string, amount: number, desc: string) =>
        `${date}|${Math.round(amount * 100)}|${(desc ?? '').trim().toLowerCase()}`
      const existingSigs = new Set(
        useTransactionStore.getState().transactions
          .filter(t => t.accountId === accountId)
          .map(t => sig(t.date, t.amount, t.description)),
      )
      const seen = new Set<string>()
      const rows = valid.filter(t => {
        const s = sig(t.date, t.amount, t.description)
        if (existingSigs.has(s) || seen.has(s)) return false
        seen.add(s)
        return true
      })
      setSkippedDup(valid.length - rows.length)
      setImportedCount(rows.length)

      const txs: Transaction[] = rows.map(t => ({
        id:           crypto.randomUUID(),
        type:         t.type,
        amount:       t.amount,
        amountTry:    toBaseTry(t.amount, t.currency),  // base-currency snapshot (S2/S3)
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

      setStep('done')
    } catch (err) {
      setError('İçe aktarma başarısız oldu. Lütfen tekrar deneyin.')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} title="İşlemleri İçe Aktar" size="lg">
      <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />

      {/* ── Upload step ── */}
      {step === 'upload' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            İşlem verilerinizi CSV formatında yükleyin. Dosyayı yükledikten sonra hangi sütunun
            hangi alana karşılık geldiğini belirleyeceksiniz.
          </p>

          <div
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-2xl py-12 cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl">
              📂
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold">CSV dosyası seçin</div>
              <div className="text-xs text-muted-foreground mt-1">veya buraya sürükleyin</div>
            </div>
          </div>

          <div className="rounded-xl bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Beklenen sütunlar:</span> Tarih, Açıklama, Tutar, Tür — diğerleri opsiyoneldir.
            Sütun adları farklıysa bir sonraki adımda eşleştirebilirsiniz.
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
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{parsed.rows.length}</span> satır bulundu.
              Her uygulama alanı için CSV sütununu seçin.
            </div>
            <button
              onClick={() => { reset(); fileRef.current?.click() }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Dosyayı değiştir
            </button>
          </div>

          {/* Account selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              Hesap <span className="text-destructive">*</span>
            </label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="text-sm border border-border bg-background text-foreground px-3 py-2.5 rounded-xl focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Hesap seçin…</option>
              {activeAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
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
                  <select
                    value={mapping[field] ?? ''}
                    onChange={e => setMapping(m => ({ ...m, [field]: e.target.value || undefined }))}
                    className="flex-1 text-xs border border-border bg-background text-foreground px-3 py-2 rounded-xl focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="">{isRequired ? 'Sütun seçin…' : 'Yok (atla)'}</option>
                    {parsed.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>

          {/* Preview row */}
          {parsed.rows[0] && (
            <div className="rounded-xl bg-muted/40 p-3 flex flex-col gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">İlk Satır Önizleme</div>
              {ALL_FIELDS.filter(f => mapping[f]).map(f => (
                <div key={f} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground w-32 flex-shrink-0">{APP_FIELD_LABELS[f].replace(' (opsiyonel)', '')}:</span>
                  <span className="text-foreground font-medium truncate">{parsed.rows[0][mapping[f]!] ?? '–'}</span>
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
            <Button onClick={handleValidate} className="flex-1 rounded-xl">Doğrula →</Button>
          </div>
        </div>
      )}

      {/* ── Validation step ── */}
      {step === 'validate' && (
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-green-600/10 border border-green-600/20 p-4 flex flex-col gap-1">
              <div className="text-2xl font-bold text-green-600">{valid.length}</div>
              <div className="text-xs text-muted-foreground">geçerli satır</div>
            </div>
            <div className={`rounded-xl p-4 flex flex-col gap-1 border ${rowErrors.length > 0 ? 'bg-destructive/10 border-destructive/20' : 'bg-muted/40 border-border'}`}>
              <div className={`text-2xl font-bold ${rowErrors.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{rowErrors.length}</div>
              <div className="text-xs text-muted-foreground">hatalı satır (atlanacak)</div>
            </div>
          </div>

          {/* Error list */}
          {rowErrors.length > 0 && (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              <div className="text-xs font-semibold text-destructive mb-1">Hatalı Satırlar</div>
              {rowErrors.map(e => (
                <div key={e.row} className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Satır {e.row}:</span> {e.message}
                </div>
              ))}
            </div>
          )}

          {valid.length === 0 && (
            <div className="text-sm text-center text-muted-foreground py-4">
              İçe aktarılacak geçerli satır yok. Eşleştirmeyi düzeltin.
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
              disabled={valid.length === 0 || importing}
              loading={importing}
              className="flex-1 rounded-xl"
            >
              {valid.length} İşlemi İçe Aktar
            </Button>
          </div>
        </div>
      )}

      {/* ── Done step ── */}
      {step === 'done' && (
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-600/10 flex items-center justify-center text-3xl">
            ✅
          </div>
          <div>
            <div className="text-base font-semibold">İçe Aktarma Tamamlandı</div>
            <div className="text-sm text-muted-foreground mt-1">
              <span className="font-semibold text-foreground">{importedCount}</span> işlem başarıyla eklendi.
              {skippedDup > 0 && (
                <div className="mt-1">{skippedDup} mükerrer satır atlandı.</div>
              )}
            </div>
          </div>
          <Button onClick={handleClose} className="px-8 rounded-xl">Kapat</Button>
        </div>
      )}
    </Modal>
  )
}
