'use client'

import { useUIStore } from '@/store'
import type { PeriodType } from '@/types'

const PERIODS: { type: PeriodType; label: string }[] = [
  { type: 'daily',   label: 'Günlük' },
  { type: 'weekly',  label: 'Haftalık' },
  { type: 'monthly', label: 'Aylık' },
  { type: 'yearly',  label: 'Yıllık' },
  { type: 'all',     label: 'Tüm Zamanlar' },
]

export function PeriodTabs() {
  const periodType    = useUIStore(s => s.periodType)
  const setPeriodType = useUIStore(s => s.setPeriodType)

  return (
    <div className="flex items-center gap-1 px-6 py-3 border-b border-border/50 bg-transparent overflow-x-auto flex-shrink-0">
      {PERIODS.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => setPeriodType(type)}
          className={[
            'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors',
            periodType === type
              ? 'bg-secondary text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
