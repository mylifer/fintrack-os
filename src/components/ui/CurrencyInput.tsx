'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'
import type { CurrencyCode } from '@/types'
import { getCurrencySymbol } from '@/lib/utils/currency'

interface CurrencyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: string
  error?: string
  currency?: CurrencyCode
  value: string
  onChange: (raw: string) => void
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ label, error, currency = 'TRY', value, onChange, className = '', id, ...props }, ref) => {
    const inputId = id ?? 'currency-input'
    const symbol = getCurrencySymbol(currency)

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
            {label}
          </label>
        )}
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-muted-foreground pointer-events-none">
            {symbol}
          </span>
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={e => onChange(e.target.value)}
            className={[
              'w-full bg-card text-foreground text-sm pl-9 pr-3.5 py-2.5 rounded-xl',
              'border border-border focus:border-accent outline-none',
              'placeholder:text-muted-foreground font-mono tabular transition-colors duration-100',
              'text-right',
              error ? 'border-danger focus:border-danger' : '',
              className,
            ].join(' ')}
            placeholder="0,00"
            {...props}
          />
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    )
  },
)
CurrencyInput.displayName = 'CurrencyInput'
