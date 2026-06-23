'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import type { CurrencyCode } from '@/types'
import { getCurrencySymbol } from '@/lib/utils/currency'

interface CurrencyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?:    string
  error?:    string
  currency?: CurrencyCode
  value:     string
  onChange:  (raw: string) => void
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ label, error, currency = 'TRY', value, onChange, className, id, ...props }, ref) => {
    const inputId = id ?? 'currency-input'
    const symbol  = getCurrencySymbol(currency)

    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground pointer-events-none select-none">
          {symbol}
        </span>
        <input
          ref={ref}
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0,00"
          aria-invalid={!!error}
          className={cn(
            "h-9 w-full rounded-md border bg-background dark:bg-muted pl-9 pr-3 text-sm font-mono tabular-nums text-right outline-none transition-colors",
            "placeholder:text-muted-foreground",
            "focus:ring-2 focus:ring-ring/50 focus:border-ring",
            "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
            error ? "border-destructive" : "border-input",
            className,
          )}
          {...props}
        />
      </div>
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'
