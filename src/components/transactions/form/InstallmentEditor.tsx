'use client'

import { parseCurrencyInput, getCurrencySymbol, formatCurrency } from '@/lib/utils/currency'
import { splitInstallments, sumMoney } from '@/lib/utils/money'
import { rebalanceInstallmentsBelow } from '@/lib/utils/installments'
import { today } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import type { Account, CurrencyCode } from '@/types'
import { toAmountStr, type TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

export interface InstallmentEditorProps {
  form: TxForm
  amountStr: string
  accounts: Account[]
  errors: Record<string, string>
  installments: number
  manualAmounts: string[] | null
}

export type InstallmentEditorSetters = Pick<TransactionFormState, 'setInstallments' | 'setManualAmounts' | 'setErrors'>

// Taksit detayı — sayı + taksit tutarları (elle düzenlenebilir).
export function InstallmentEditor({
  form, amountStr, accounts, errors, setErrors, installments, setInstallments, manualAmounts, setManualAmounts,
}: InstallmentEditorProps & InstallmentEditorSetters) {
  return (
    <div className="rounded-lg border border-dashed p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Taksit sayısı</span>
        <input
          type="number"
          min={2}
          max={60}
          value={installments}
          onChange={e => {
            setInstallments(Math.min(60, Math.max(2, Number(e.target.value) || 2)))
            setManualAmounts(null)
          }}
          className="w-20 h-9 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm text-center outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
        />
        <span className="text-sm text-muted-foreground">taksit</span>
      </div>
      {parseCurrencyInput(amountStr) > 0 && (() => {
        const total    = parseCurrencyInput(amountStr)
        const cur      = (accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode
        const rows     = manualAmounts ?? splitInstallments(total, installments).map(toAmountStr)
        const sum      = sumMoney(rows.map(s => parseCurrencyInput(s) || 0))
        const sumDiff  = Math.round(sum * 100) !== Math.round(total * 100)
        return (
          <div className="flex flex-col gap-2 border-t border-dashed pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Aylık taksitler {manualAmounts ? '(elle düzenlendi — alttakiler kalana göre eşitlenir)' : '(otomatik bölündü — düzenlenebilir)'}
              </span>
              {manualAmounts && (
                <button
                  type="button"
                  onClick={() => setManualAmounts(null)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Otomatik böl
                </button>
              )}
            </div>
            <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {rows.map((val, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-32 shrink-0">
                    {i + 1}. taksit · {format(addMonths(parseISO(form.date || today()), i), 'MMM yyyy', { locale: tr })}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={val}
                    onChange={e => {
                      let raw = e.target.value.replace(/[^0-9,]/g, '')
                      const fc = raw.indexOf(',')
                      if (fc !== -1) raw = raw.slice(0, fc + 1) + raw.slice(fc + 1).replace(/,/g, '')
                      // Düzenlenen taksit ve üstündekiler aynen kalır;
                      // toplamdan kalan alttaki taksitlere eşit bölünür.
                      const balanced = rebalanceInstallmentsBelow(
                        total, rows.map((s, j) => parseCurrencyInput(j === i ? raw : s) || 0), i)
                      setManualAmounts(rows.map((s, j) =>
                        j < i ? s : j === i ? raw : toAmountStr(balanced[j])))
                      if (errors.installments) setErrors(prev => ({ ...prev, installments: '' }))
                    }}
                    aria-label={`${i + 1}. taksit tutarı`}
                    className="flex-1 h-8 rounded-md border border-input bg-background dark:bg-muted px-2.5 text-sm text-right outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                  />
                  <span className="text-xs text-muted-foreground w-8">{getCurrencySymbol(cur)}</span>
                </div>
              ))}
            </div>
            <p className={cn('text-xs', sumDiff ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground')}>
              Toplam: {formatCurrency(sum, cur)}
              {sumDiff && ` — girilen tutardan (${formatCurrency(total, cur)}) farklı`}
            </p>
            {errors.installments && <p className="text-xs text-destructive">{errors.installments}</p>}
          </div>
        )
      })()}
    </div>
  )
}
