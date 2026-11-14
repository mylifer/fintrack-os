'use client'

import { useMemo, useState } from 'react'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Badge } from '@/components/ui/Badge'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { useBudgetStore, selectTotalBudget } from '@/store'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { summarizeTotalBudget } from '@/lib/utils/calculations'
import type { Budget, MonthYear, Transaction } from '@/types'

/* Toplam aylık harcama limiti — Bütçeler sayfasının üstünde. Hesap saf:
   summarizeTotalBudget (harcama tanımı Raporlar'la aynı). `ledger` sayfanın
   collapseInstallments uygulanmış defteridir. Salt okuma alanında (0028)
   düzenleme düğmeleri görünmez; kilit yine de yazma katmanındadır. */

export function TotalBudgetCard({
  ledger, period, budgets, readOnly,
}: {
  ledger: Transaction[]
  period: MonthYear
  budgets: Budget[]
  readOnly: boolean
}) {
  const total = useBudgetStore(selectTotalBudget)
  const setTotalLimit = useBudgetStore(s => s.setTotalLimit)

  const summary = useMemo(
    () => (total ? summarizeTotalBudget(total, ledger, period, budgets) : null),
    [total, ledger, period, budgets],
  )

  const [open, setOpen]         = useState(false)
  const [amtStr, setAmtStr]     = useState('')
  const [threshold, setThreshold] = useState('80')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  function openForm() {
    setAmtStr(total ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(total.amount) : '')
    setThreshold(String(total?.alertThreshold ?? 80))
    setError('')
    setOpen(true)
  }

  async function save(amount: number | null) {
    setSaving(true); setError('')
    try {
      await setTotalLimit(amount, Number(threshold) || 80)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const modal = (
    <Modal open={open} onClose={() => setOpen(false)} title="Toplam aylık limit" size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Bu alanın tüm aylık giderleri sayılır — Raporlar&apos;daki aylık giderle aynı: transferler, yatırım ve
          borç anaparası sayılmaz; iadeler düşülür; taksitli alım satın alma ayına yazılır.
        </p>
        <CurrencyInput label="Aylık limit" value={amtStr} onChange={setAmtStr} />
        <Input
          label="Uyarı Eşiği (%)"
          type="number"
          min={50}
          max={100}
          value={threshold}
          onChange={e => setThreshold(e.target.value)}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-col gap-2">
          <Button onClick={() => save(parseCurrencyInput(amtStr))} loading={saving} fullWidth disabled={!parseCurrencyInput(amtStr)}>
            Kaydet
          </Button>
          {total && (
            <Button variant="secondary" onClick={() => save(null)} disabled={saving} fullWidth>Limiti kaldır</Button>
          )}
        </div>
      </div>
    </Modal>
  )

  if (!total || !summary) {
    if (readOnly) return null
    return (
      <div className="rounded-xl border border-dashed border-border p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Toplam aylık limit</div>
          <div className="text-xs text-muted-foreground">Kategorilerden bağımsız, bu alanın tüm aylık harcamaları için tek bir üst sınır.</div>
        </div>
        <Button size="sm" variant="secondary" onClick={openForm}>Limit belirle</Button>
        {modal}
      </div>
    )
  }

  const s = summary
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3" data-testid="total-budget">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Toplam aylık bütçe</div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`text-2xl font-medium tabular-nums ${
              s.status === 'exceeded' ? 'text-destructive' : s.status === 'warning' ? 'text-orange-500' : ''
            }`}>
              <AnimatedNumber value={s.spent} format={formatCurrency} />
            </span>
            <span className="text-sm text-muted-foreground">/ {formatCurrency(s.limit)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {s.status !== 'ok' && (
            <Badge variant={s.status === 'exceeded' ? 'danger' : 'warning'}>
              {s.status === 'exceeded' ? 'Aşıldı' : 'Uyarı'}
            </Badge>
          )}
          {!readOnly && <Button size="sm" variant="secondary" onClick={openForm}>Düzenle</Button>}
        </div>
      </div>

      <ProgressBar percent={s.percentUsed} status={s.status} showLabel />

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {s.overBy > 0
            ? <span className="text-destructive">{formatCurrency(s.overBy)} aşım</span>
            : <>{formatCurrency(s.remaining)} kaldı</>}
        </span>
        <span>
          {s.daysLeft > 0
            ? <>Ay sonuna {s.daysLeft} gün · günde ortalama <strong className="text-foreground">{formatCurrency(s.dailyRemaining)}</strong></>
            : 'Ay kapandı'}
        </span>
        <span>%{total.alertThreshold} uyarı</span>
      </div>

      {s.categoryBudgetsExceedLimit && (
        <div role="alert" className="rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400 px-3 py-2 text-xs">
          Kategori bütçelerinin toplamı ({formatCurrency(s.categoryBudgetsTotal)}) toplam limiti
          ({formatCurrency(s.limit)}) {formatCurrency(s.categoryBudgetsTotal - s.limit)} aşıyor — hepsi dolarsa toplam limit aşılır.
        </div>
      )}
      {modal}
    </div>
  )
}
