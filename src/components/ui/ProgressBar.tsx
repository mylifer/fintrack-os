'use client'

import type { BudgetStatus } from '@/types'

interface ProgressBarProps {
  percent: number
  status?: BudgetStatus
  className?: string
  showLabel?: boolean
}

const fillColor: Record<BudgetStatus, string> = {
  ok:       'bg-accent',
  warning:  'bg-amber',
  exceeded: 'bg-danger',
}

export function ProgressBar({ percent, status = 'ok', className = '', showLabel }: ProgressBarProps) {
  const capped = Math.min(percent, 100)

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${fillColor[status]}`}
          style={{ width: `${capped}%` }}
        />
      </div>
      {showLabel && (
        <span className={`font-mono text-[10px] tabular w-8 text-right ${
          status === 'exceeded' ? 'text-danger' : status === 'warning' ? 'text-amber' : 'text-muted'
        }`}>
          {Math.round(percent)}%
        </span>
      )}
    </div>
  )
}
