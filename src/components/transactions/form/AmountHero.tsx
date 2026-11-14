'use client'

import { useState, useLayoutEffect, useRef, type RefObject } from 'react'
import { getCurrencySymbol } from '@/lib/utils/currency'
import { cn } from '@/lib/utils'
import type { CurrencyCode } from '@/types'
import { formatTurkishDisplay, type Tab } from './form-model'

// ── Amount hero ───────────────────────────────────────────────────────────────
// Büyük tutar alanı: görünür sayı, ölçüm aynası, özel imleç ve yazmayı yakalayan
// görünmez input. İmleç konumu ve FLIP kaydırma animasyonu yalnızca bu alanın
// durumudur; girilen değer temizlenip `onAmountChange` ile forma iletilir.
export function AmountHero({
  tab, amountSign, amountStr, currency, error, inputRef, onAmountChange,
}: {
  tab: Tab
  amountSign: number
  amountStr: string
  currency: CurrencyCode
  error?: string
  inputRef: RefObject<HTMLInputElement | null>
  /** Temizlenmiş ham değer (yalnızca rakamlar + tek virgül). */
  onAmountChange: (raw: string) => void
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [cursorX, setCursorX]    = useState(0)
  const mirrorRef         = useRef<HTMLSpanElement>(null)
  const numberContainerRef = useRef<HTMLDivElement>(null)
  const oldContainerLeftRef = useRef(0)

  // FLIP slide-left animation: fires after React paints the new (wider) number,
  // offsets back to old position instantly, then transitions to the natural position.
  useLayoutEffect(() => {
    const el = numberContainerRef.current
    if (!el || !amountStr) return
    const newLeft = el.getBoundingClientRect().left
    const delta   = oldContainerLeftRef.current - newLeft   // positive = shifted left
    if (delta < 0.5) return                                  // deleted or no change
    el.style.transition = 'none'
    el.style.transform  = `translateX(${delta}px)`
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform 240ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      el.style.transform  = 'translateX(0)'
    }))
  }, [amountStr])

  return (
    <div className="relative h-24 flex items-center justify-center border-b bg-muted/50">
      <div className="flex items-center gap-2 select-none pointer-events-none">
        {tab !== 'transfer' && (
          <span className={cn(
            "text-2xl font-semibold leading-none transition-colors duration-200",
            tab === 'expense' && amountSign < 0
              ? "text-green-600"
              : amountStr ? "text-muted-foreground/50" : "text-muted-foreground/25",
          )}>
            {tab === 'income' || (tab === 'expense' && amountSign < 0) ? '+' : '−'}
          </span>
        )}
        <span className={cn(
          "text-2xl font-semibold leading-none transition-colors duration-200",
          amountStr ? "text-muted-foreground/50" : "text-muted-foreground/25",
        )}>
           a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode)}=>{getCurrencySymbol(currency)}=> a.id === form.accountId)?.currency ?? 'TRY') as CurrencyCode)}
        </span>

        {/* Number + custom smooth caret */}
        <div ref={numberContainerRef} className="relative leading-none">
          <span className={cn(
            "text-5xl font-bold tabular-nums leading-none",
            amountStr ? "text-foreground" : "text-muted-foreground/25",
            error && "!text-destructive",
          )}>
            {formatTurkishDisplay(amountStr)}
          </span>

          {/* Hidden mirror — measures rendered text width for caret positioning */}
          <span
            ref={mirrorRef}
            aria-hidden
            className="invisible absolute left-0 top-0 whitespace-pre text-5xl font-bold tabular-nums leading-none pointer-events-none"
          >
            {formatTurkishDisplay(amountStr)}
          </span>

          {/* Smooth caret */}
          {isFocused && (
            <div
              className="amount-caret absolute top-[1px] bottom-[1px] w-[2.5px] rounded-full bg-foreground"
              style={{ left: 0, transform: `translateX(${cursorX}px)`, transition: 'transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94)' }}
            />
          )}
        </div>
      </div>

      {/* Error floats at bottom, doesn't affect centering */}
      {error && (
        <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-destructive">{error}</p>
      )}

      {/* Invisible input overlay captures typing */}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={amountStr}
        onFocus={() => {
          setIsFocused(true)
          requestAnimationFrame(() => {
            if (mirrorRef.current) setCursorX(mirrorRef.current.offsetWidth)
          })
        }}
        onBlur={() => setIsFocused(false)}
        onChange={e => {
          // Capture position BEFORE state update for FLIP animation
          oldContainerLeftRef.current = numberContainerRef.current?.getBoundingClientRect().left ?? 0

          let raw = e.target.value.replace(/[^0-9,]/g, '')
          const firstComma = raw.indexOf(',')
          if (firstComma !== -1) {
            raw = raw.slice(0, firstComma + 1) + raw.slice(firstComma + 1).replace(/,/g, '')
          }
          onAmountChange(raw)
          requestAnimationFrame(() => {
            if (mirrorRef.current) setCursorX(mirrorRef.current.offsetWidth)
          })
        }}
        aria-label="Tutar"
        aria-invalid={!!error}
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
    </div>
  )
}
