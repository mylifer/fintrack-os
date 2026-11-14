'use client'

import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { toBaseTry } from '@/lib/utils/fx'
import type { splitInterest } from '@/lib/utils/interest-tax'
import { cn } from '@/lib/utils'
import type { Account, CurrencyCode, Debt } from '@/types'
import { AppSelect } from './fields'
import type { TxForm } from './form-model'
import type { TransactionFormState } from './useTransactionFormState'

  // Gelir sekmesinde "Gelir | Alacak" anahtarı — transferdeki "Hesap | Borç"
  // anahtarının karşılığı. Alacağa geçince kategori/bölme bırakılır; kayıtta
  // satır kategori taşımaz (bkz. collectionFields).
export function IncomeModeToggle({
  isCollection, form, patch, receivables, setSplits, setAutoCategory, setErrors,
}: {
  isCollection: boolean
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  receivables: Debt[]
} & Pick<TransactionFormState, 'setSplits' | 'setAutoCategory' | 'setErrors'>) {
  return (
    <div className="flex rounded border border-input overflow-hidden text-[11px]">
      <button
        type="button"
        onClick={() => patch({ isDebtPayment: false, debtId: undefined })}
        className={cn(
          "px-2 py-0.5 transition-colors",
          !isCollection ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Gelir
      </button>
      <button
        type="button"
        onClick={() => {
          setSplits(null)
          setAutoCategory(null)
          setErrors(prev => ({ ...prev, categoryId: '', categorySplits: '' }))
          // Tek alacak varsa doğrudan seçilir (açıklama boşsa listeden seçimle aynı doldurulur).
          const only = !form.debtId && receivables.length === 1 ? receivables[0] : undefined
          patch({
            isDebtPayment: true,
            debtId: form.debtId ?? only?.id,
            ...(only && !form.description.trim() ? { description: `${only.name} tahsilatı` } : {}),
          })
        }}
        className={cn(
          "px-2 py-0.5 transition-colors border-l border-input",
          isCollection ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
        )}
      >
        Alacak
      </button>
    </div>
  )
}

// Alacak tahsilatında kategori yerine gösterilen "Alacak" seçimi.
export function CollectionField({
  form, patch, errors, setErrors, receivables, incomeModeToggle, onSelectOpen,
}: {
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  errors: Record<string, string>
  setErrors: TransactionFormState['setErrors']
  receivables: Debt[]
  incomeModeToggle: ReactNode
  onSelectOpen: (open: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className={cn("text-sm font-medium", errors.debtId && "text-destructive")}>Alacak</Label>
        {incomeModeToggle}
      </div>
      {receivables.length === 0 ? (
        <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
          Açık alacağınız yok
        </div>
      ) : (
        <AppSelect
          value={form.debtId ?? ''}
          onChange={v => {
            const debt = receivables.find(d => d.id === v)
            if (errors.debtId || errors.amount) setErrors(prev => ({ ...prev, debtId: '', amount: '' }))
            patch({ debtId: v, ...(debt && !form.description.trim() ? { description: `${debt.name} tahsilatı` } : {}) })
          }}
          options={receivables.map(d => ({ value: d.id, label: d.name }))}
          placeholder="Alacak seçin..."
          error={!!errors.debtId}
          onOpenChange={onSelectOpen}
        />
      )}
      {errors.debtId && <p className="text-xs text-destructive">{errors.debtId}</p>}
    </div>
  )
}

// Faiz stopajı — Brüt · Stopaj · Net.
export function InterestTaxSection({
  errors, setErrors, interestMode, setInterestMode, interestRateStr, setInterestRateStr,
  interestSplit, interestAccount, defaultTaxRate,
}: {
  errors: Record<string, string>
  interestSplit: ReturnType<typeof splitInterest>
  interestAccount: Account | undefined
  defaultTaxRate: number
} & Pick<TransactionFormState,
  'setErrors' | 'interestMode' | 'setInterestMode' | 'interestRateStr' | 'setInterestRateStr'
>) {
  return (
    <div className="-mt-1 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className={cn("text-sm font-medium", errors.interestRate && "text-destructive")}>Stopaj</span>
        <div className="flex rounded border border-input overflow-hidden text-[11px]" title="Girdiğin tutar bankanın yatırdığı net tutar mı, brüt faiz mi?">
          {(['net', 'gross'] as const).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setInterestMode(m)}
              className={cn(
                "px-2 py-0.5 transition-colors",
                i > 0 && "border-l border-input",
                interestMode === m ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === 'net' ? 'Net girdim' : 'Brüt girdim'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 rounded-lg border border-input overflow-hidden text-xs">
        <div className="flex flex-col gap-0.5 px-3 py-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Brüt faiz</span>
          <span className="text-sm font-semibold tabular-nums text-green-600 truncate">{formatCurrency(interestSplit.gross, interestAccount?.currency ?? 'TRY')}</span>
          <span className="text-muted-foreground">Gelir · Faiz</span>
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2 min-w-0 border-l border-input">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Stopaj</span>
          <span className="text-sm font-semibold tabular-nums text-destructive truncate">−{formatCurrency(interestSplit.tax, interestAccount?.currency ?? 'TRY')}</span>
          <label className="flex items-center gap-1 text-muted-foreground">
            %
            <input
              type="text"
              inputMode="decimal"
              aria-label="Stopaj oranı"
              value={interestRateStr ?? String(defaultTaxRate).replace('.', ',')}
              onChange={e => {
                setInterestRateStr(e.target.value.replace(/[^0-9,.]/g, ''))
                if (errors.interestRate) setErrors(prev => ({ ...prev, interestRate: '' }))
              }}
              aria-invalid={!!errors.interestRate}
              className={cn(
                "w-12 h-5 rounded border bg-transparent px-1 text-right tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                errors.interestRate ? "border-destructive" : "border-input",
              )}
            />
          </label>
        </div>
        <div className="flex flex-col gap-0.5 px-3 py-2 min-w-0 border-l border-input">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hesaba geçen</span>
          <span className="text-sm font-semibold tabular-nums truncate">{formatCurrency(interestSplit.net, interestAccount?.currency ?? 'TRY')}</span>
          <span className="text-muted-foreground">Net</span>
        </div>
      </div>
      {errors.interestRate
        ? <p className="text-xs text-destructive">{errors.interestRate}</p>
        : <p className="text-xs text-muted-foreground">Stopaj, Vergi kategorisine alıcısı İTC olan ayrı bir gider olarak yazılır.</p>}
    </div>
  )
}

// Alacak tahsilatı özeti — kalan alacak bu kayıttan sonra ne olur.
export function ReceivableSummary({
  accounts, form, amountStr, receivableRemaining,
}: {
  accounts: Account[]
  form: TxForm
  amountStr: string
  receivableRemaining: number
}) {
  const cur   = (accounts.find(a => a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode
  const paid  = toBaseTry(parseCurrencyInput(amountStr), cur)
  const after = Math.round((receivableRemaining - paid) * 100) / 100
  return (
    <div className="-mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
      <span className="tabular-nums">
        Kalan alacak <span className="font-medium text-foreground">{formatCurrency(receivableRemaining, 'TRY')}</span>
        {paid > 0 && after >= 0 && (
          <> → <span className="font-medium text-foreground">{after === 0 ? 'kapanır' : formatCurrency(after, 'TRY')}</span></>
        )}
      </span>
      <span>Gelir sayılmaz; yalnızca hesap bakiyesi artar.</span>
    </div>
  )
}
