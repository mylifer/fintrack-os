'use client'

import { useUIStore } from '@/store'

interface HeaderProps {
  title: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function Header({ title, action }: HeaderProps) {
  const openModal = useUIStore(s => s.openModal)

  return (
    <header className="flex items-center justify-between px-6 py-5 border-b border-border/50 bg-card sticky top-0 z-30">
      <h1 className="text-base font-semibold text-foreground tracking-tight">{title}</h1>

      <div className="flex items-center gap-2">
        {action && (
          <button
            onClick={action.onClick}
            className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            {action.label}
          </button>
        )}
        <button
          onClick={() => openModal('add-transaction')}
          className="lg:hidden flex items-center gap-1.5 px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          + İşlem
        </button>
      </div>
    </header>
  )
}
