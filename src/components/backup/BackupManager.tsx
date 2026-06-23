'use client'

import { useState, useRef } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { db } from '@/lib/db'
import {
  useAccountStore, useTransactionStore, useCategoryStore,
  useBudgetStore, useDebtStore, useInvestmentStore,
  usePeopleStore, useRecurringStore,
} from '@/store'

/* ── Types ───────────────────────────────────────────────────── */

interface BackupFile {
  version: number
  exportedAt: string
  data: {
    accounts:               unknown[]
    transactions:           unknown[]
    categories:             unknown[]
    budgets:                unknown[]
    debts:                  unknown[]
    investmentTransactions: unknown[]
    people:                 unknown[]
    recurringTransactions:  unknown[]
  }
}

const TABLE_LABELS: Record<keyof BackupFile['data'], string> = {
  accounts:               'Hesap',
  transactions:           'İşlem',
  categories:             'Kategori',
  budgets:                'Bütçe',
  debts:                  'Borç',
  investmentTransactions: 'Yatırım İşlemi',
  people:                 'Kişi',
  recurringTransactions:  'Tekrarlayan İşlem',
}

/* ── Helpers ─────────────────────────────────────────────────── */

function validateBackup(raw: unknown): BackupFile {
  const b = raw as BackupFile
  if (!b?.version || !b?.exportedAt || !b?.data) throw new Error('Geçersiz yedek formatı.')
  for (const key of ['accounts', 'transactions', 'categories', 'budgets', 'debts'] as const) {
    if (!Array.isArray(b.data[key])) throw new Error(`"${key}" alanı eksik veya bozuk.`)
  }
  // Tables added in later versions — treat missing as empty arrays (backward compat)
  b.data.investmentTransactions ??= []
  b.data.people                 ??= []
  b.data.recurringTransactions  ??= []
  return b
}

/* ── Component ───────────────────────────────────────────────── */

export function BackupManager() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview,   setPreview]   = useState<BackupFile | null>(null)
  const [fileName,  setFileName]  = useState('')
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')

  const loadAccounts     = useAccountStore(s => s.load)
  const loadTransactions = useTransactionStore(s => s.load)
  const loadCategories   = useCategoryStore(s => s.load)
  const initCategories   = useCategoryStore(s => s.initDefaults)
  const loadBudgets      = useBudgetStore(s => s.load)
  const loadDebts        = useDebtStore(s => s.load)
  const loadInvestments  = useInvestmentStore(s => s.load)
  const loadPeople       = usePeopleStore(s => s.load)
  const loadRecurring    = useRecurringStore(s => s.load)

  /* ── Export ─────────────────────────────────────────────── */

  async function handleExport() {
    setExporting(true)
    setError('')
    try {
      const [accounts, transactions, categories, budgets, debts, investmentTransactions, people, recurringTransactions] =
        await Promise.all([
          db.accounts.toArray(),
          db.transactions.toArray(),
          db.categories.toArray(),
          db.budgets.toArray(),
          db.debts.toArray(),
          db.investmentTransactions.toArray(),
          db.people.toArray(),
          db.recurringTransactions.toArray(),
        ])

      const backup: BackupFile = {
        version:    2,
        exportedAt: new Date().toISOString(),
        data:       { accounts, transactions, categories, budgets, debts, investmentTransactions, people, recurringTransactions },
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: `fintrack-backup-${new Date().toISOString().slice(0, 10)}.json`,
      })
      a.click()
      URL.revokeObjectURL(url)

      flash('success', 'Yedek başarıyla indirildi.')
    } catch {
      setError('Yedek alınırken bir hata oluştu.')
    } finally {
      setExporting(false)
    }
  }

  /* ── File select ─────────────────────────────────────────── */

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-selecting the same file
    if (!file) return

    setError('')
    setFileName(file.name)
    setPreview(null)

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const backup = validateBackup(JSON.parse(ev.target?.result as string))
        setPreview(backup)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dosya okunamadı.')
      }
    }
    reader.onerror = () => setError('Dosya okunamadı.')
    reader.readAsText(file)
  }

  /* ── Import ─────────────────────────────────────────────── */

  async function handleImport() {
    if (!preview) return
    setImporting(true)
    setError('')

    try {
      const { data } = preview

      // Atomic: clear everything then bulk insert — rolls back on any failure
      await db.transaction('rw',
        [db.accounts, db.transactions, db.categories, db.budgets, db.debts, db.investmentTransactions, db.people, db.recurringTransactions],
        async () => {
          await Promise.all([
            db.accounts.clear(),
            db.transactions.clear(),
            db.categories.clear(),
            db.budgets.clear(),
            db.debts.clear(),
            db.investmentTransactions.clear(),
            db.people.clear(),
            db.recurringTransactions.clear(),
          ])
          await Promise.all([
            data.accounts.length               && db.accounts.bulkAdd(data.accounts                             as never),
            data.transactions.length           && db.transactions.bulkAdd(data.transactions                     as never),
            data.categories.length             && db.categories.bulkAdd(data.categories                         as never),
            data.budgets.length                && db.budgets.bulkAdd(data.budgets                               as never),
            data.debts.length                  && db.debts.bulkAdd(data.debts                                   as never),
            data.investmentTransactions.length && db.investmentTransactions.bulkAdd(data.investmentTransactions as never),
            data.people.length                 && db.people.bulkAdd(data.people                                 as never),
            data.recurringTransactions.length  && db.recurringTransactions.bulkAdd(data.recurringTransactions   as never),
          ])
        },
      )

      // Reload all Zustand stores from fresh DB state
      await Promise.all([
        loadAccounts(),
        loadTransactions(),
        loadCategories().then(initCategories),
        loadBudgets(),
        loadDebts(),
        loadInvestments(),
        loadPeople(),
        loadRecurring(),
      ])

      setPreview(null)
      setFileName('')
      flash('success', 'Yedek başarıyla geri yüklendi.')
    } catch (err) {
      setError('Geri yükleme başarısız. Dosya bozuk olabilir — verileriniz korundu.')
      console.error(err)
    } finally {
      setImporting(false)
    }
  }

  /* ── Helpers ─────────────────────────────────────────────── */

  function flash(type: 'success' | 'error', msg: string) {
    if (type === 'success') { setSuccess(msg); setTimeout(() => setSuccess(''), 4000) }
    else                    { setError(msg) }
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <Card className="overflow-hidden gap-0 py-0">
      <CardHeader className="px-5 py-4 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Yedekleme</span>
      </CardHeader>

      <CardContent className="p-5 flex flex-col gap-5">

        {/* ── Export ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">Yedek Al</div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Tüm verilerinizi (hesaplar, işlemler, kategoriler, bütçeler, borçlar, yatırımlar)
              JSON dosyası olarak indirin.
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-shrink-0 px-4 h-9 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/85 disabled:opacity-40 transition-colors"
          >
            {exporting ? '...' : 'Dışa Aktar'}
          </button>
        </div>

        <div className="border-t border-border" />

        {/* ── Import ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Yedekten Geri Yükle</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Daha önce aldığınız JSON yedeğini seçin.{' '}
                <span className="text-destructive font-medium">Mevcut tüm veriler silinir.</span>
              </div>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-shrink-0 px-4 h-9 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Dosya Seç
            </button>
          </div>

          <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />

          {/* Preview card */}
          {preview && (
            <div className="rounded-xl border border-border overflow-hidden">
              {/* File info */}
              <div className="px-4 py-3 bg-background flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate">{fileName}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    Yedek tarihi: {new Date(preview.exportedAt).toLocaleString('tr-TR', {
                      day: '2-digit', month: 'long', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
                <button
                  onClick={() => { setPreview(null); setFileName('') }}
                  className="w-6 h-6 flex-shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground text-xs transition-colors"
                >✕</button>
              </div>

              {/* Record counts */}
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {(Object.keys(TABLE_LABELS) as Array<keyof BackupFile['data']>).map(key => {
                  const count = preview.data[key]?.length ?? 0
                  if (count === 0) return null
                  return (
                    <span
                      key={key}
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-muted/50 text-foreground"
                    >
                      {count} {TABLE_LABELS[key]}
                    </span>
                  )
                })}
              </div>

              {/* Warning + confirm */}
              <div className="px-4 py-3 border-t border-border bg-destructive/[0.06] flex flex-col gap-2">
                <p className="text-[10px] text-destructive font-medium">
                  Bu işlem geri alınamaz. Mevcut tüm verileriniz silinecek ve yedeğinizdeki veriler yüklenecek.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPreview(null); setFileName('') }}
                    className="flex-1 h-9 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    İptal
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    className="flex-1 h-9 rounded-xl bg-destructive text-white text-xs font-semibold hover:bg-destructive/80 disabled:opacity-40 transition-colors"
                  >
                    {importing ? 'Geri Yükleniyor...' : 'Evet, Geri Yükle'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        {error && (
          <div className="text-xs text-destructive font-medium px-4 py-2.5 bg-destructive/10 rounded-xl leading-relaxed">
            {error}
          </div>
        )}
        {success && (
          <div className="text-xs text-green-600 font-medium px-4 py-2.5 bg-green-600/10 rounded-xl">
            {success}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
