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
    <div className="flex items-center gap-1 px-6 py-3 border-b border-line bg-surface overflow-x-auto flex-shrink-0">
      {PERIODS.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => setPeriodType(type)}
          className={[
            'flex-shrink-0 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors duration-100',
            periodType === type
              ? 'bg-accent text-white'
              : 'text-muted hover:text-ink hover:bg-white/[0.05]',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
