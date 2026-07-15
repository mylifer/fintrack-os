'use client'

import type { ReactNode } from 'react'
import { useUIStore } from '@/store'
import type { PeriodType } from '@/types'

const PERIODS: { type: PeriodType; label: string }[] = [
  { type: 'daily',   label: 'Günlük' },
  { type: 'weekly',  label: 'Haftalık' },
  { type: 'monthly', label: 'Aylık' },
  { type: 'yearly',  label: 'Yıllık' },
  { type: 'all',     label: 'Tüm Zamanlar' },
]

interface Nav {
  offset: number
  label: string
  onChange: (offset: number) => void
}

export function PeriodTabs({ rightSlot, nav }: { rightSlot?: ReactNode; nav?: Nav }) {
  const periodType    = useUIStore(s => s.periodType)
  const setPeriodType = useUIStore(s => s.setPeriodType)

  const navBtnCls = 'w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg text-sm leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors'

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

      {/* Dönem gezintisi — 'Tüm Zamanlar'da anlamsız, gizlenir */}
      {nav && periodType !== 'all' && (
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
          <button onClick={() => nav.onChange(nav.offset - 1)} className={navBtnCls} title="Önceki dönem">‹</button>
          <button
            onClick={() => nav.onChange(0)}
            title={nav.offset !== 0 ? 'Bugüne dön' : undefined}
            className={[
              'px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              nav.offset !== 0
                ? 'text-primary hover:bg-secondary/60'
                : 'text-foreground cursor-default',
            ].join(' ')}
          >
            {nav.label}
          </button>
          <button onClick={() => nav.onChange(nav.offset + 1)} className={navBtnCls} title="Sonraki dönem">›</button>
        </div>
      )}

      {rightSlot && <div className="ml-auto pl-3 flex-shrink-0 flex items-center">{rightSlot}</div>}
    </div>
  )
}
