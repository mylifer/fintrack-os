"use client"

import * as React from "react"
import { addDays, format, isValid, parseISO } from "date-fns"
import { ChevronUp, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/Input"
import { today } from "@/lib/utils/date"

type DateStepperInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
}

/** Tarih girişi + yanında gün ileri/geri okları (yukarı = sonraki gün). */
function DateStepperInput({ value, onValueChange, disabled, className, ...props }: DateStepperInputProps) {
  const step = (days: number) => {
    // Boş/bozuk değerde bugünden başla; legacy tam-ISO tarih slice(0,10) ile kırpılır
    const base = parseISO((value || today()).slice(0, 10))
    onValueChange(format(addDays(isValid(base) ? base : parseISO(today()), days), "yyyy-MM-dd"))
  }

  const btn = "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"

  return (
    <div className="flex items-start gap-1.5">
      {/* error verilince Input kendini div'e sarar — flex-1 dış kutuda olmalı */}
      <div className="min-w-0 flex-1">
        <Input
          {...props}
          type="date"
          value={value}
          onChange={e => onValueChange(e.target.value)}
          disabled={disabled}
          className={className}
        />
      </div>
      <div className="flex h-9 w-8 shrink-0 flex-col overflow-hidden rounded-xl border border-input bg-background dark:bg-muted">
        <button type="button" className={btn} onClick={() => step(1)} disabled={disabled} aria-label="Sonraki gün">
          <ChevronUp className="size-3.5" />
        </button>
        <div className="h-px bg-input" />
        <button type="button" className={btn} onClick={() => step(-1)} disabled={disabled} aria-label="Önceki gün">
          <ChevronDown className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export { DateStepperInput }
