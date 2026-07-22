'use client'

import { cn } from '@/lib/utils'

// Toplu düzenleme seçim kutusu — mockup görünümü: yuvarlatılmış, mavi aksanlı,
// özel onay/kısmi-seçim işareti. Kontrollü: checked + indeterminate prop'larıyla
// sürülür. Gerçek <input> sr-only tutulur (a11y + klavye), görsel kutu span'dir.
export function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  checked?: boolean
  indeterminate?: boolean
  onChange?: () => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  const active = checked || indeterminate
  return (
    <label
      className={cn(
        'relative inline-flex items-center justify-center',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={!!checked}
        onChange={() => onChange?.()}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
      />
      <span
        aria-hidden
        className={cn(
          'grid h-[17px] w-[17px] place-items-center rounded-[5px] border-[1.5px] transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--batch-accent)]/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-background',
          active
            ? 'border-[var(--batch-accent)] bg-[var(--batch-accent)] text-white'
            : 'border-input bg-card hover:border-[var(--batch-accent)]',
        )}
      >
        {indeterminate ? (
          <span className="h-[2px] w-2 rounded-full bg-white" />
        ) : checked ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.3 4.8 8.6 9.5 3.5" />
          </svg>
        ) : null}
      </span>
    </label>
  )
}
