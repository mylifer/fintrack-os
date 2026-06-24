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
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-') ?? 'currency-input'
    const symbol  = getCurrencySymbol(currency)

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      // Allow digits, comma, period, and a leading minus
      const filtered = e.target.value.replace(/[^0-9,.-]/g, '')
      onChange(filtered)
    }

    const input = (
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
          onChange={handleChange}
          placeholder="0,00"
          aria-invalid={!!error}
          className={cn(
            "h-9 w-full rounded-xl border bg-background dark:bg-muted pl-9 pr-3 text-sm font-mono tabular-nums text-right outline-none transition-colors",
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

    if (!label && !error) return input

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
            {label}
          </label>
        )}
        {input}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'
