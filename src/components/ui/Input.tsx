'use client'

import { type InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold tracking-wide uppercase text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'w-full bg-surface text-ink text-sm px-3.5 py-2.5 rounded-xl',
            'border border-line focus:border-accent outline-none',
            'placeholder:text-muted transition-colors duration-100',
            error ? 'border-danger focus:border-danger' : '',
            className,
          ].join(' ')}
          {...props}
        />
        {error && <span className="text-xs text-danger">{error}</span>}
        {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      </div>
    )
  },
)
Input.displayName = 'Input'
