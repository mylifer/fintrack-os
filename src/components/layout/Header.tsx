'use client'

import { useUIStore, useWorkspaceStore, selectActiveReadOnly } from '@/store'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'

interface HeaderProps {
  title: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function Header({ title, action }: HeaderProps) {
  const openModal = useUIStore(s => s.openModal)
  // Salt okuma alanında (0028) ekleme düğmeleri gösterilmez — yalnız ipucu;
  // kilit yerel yazma katmanında (sync/engine) ve sunucuda.
  const readOnly  = useWorkspaceStore(selectActiveReadOnly)

  return (
    <header className="flex items-center justify-between px-6 py-5 border-b border-border bg-background sticky top-[var(--safe-top)] z-30">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>

      <div className="flex items-center gap-2 print:hidden">
        {/* Gizlilik ve bildirim mobilde üst çubukta (MobileTopBar): Header'ı
            olmayan sayfalarda da görünsünler ve telefonda aynı düğme iki kez
            çıkmasın. Masaüstünde yeri burası. */}
        <div className="hidden lg:flex items-center gap-2">
          <PrivacyToggle className="w-9 h-9 rounded-xl" />
          <NotificationBell />
        </div>
        {/* h-11 (44px) dokunmatikte; masaüstünde eski h-9 yoğunluğu korunur. */}
        {action && !readOnly && (
          <button
            onClick={action.onClick}
            className="flex items-center gap-1.5 px-4 h-11 lg:h-9 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            {action.label}
          </button>
        )}
        {!action && !readOnly && (
          <button
            onClick={() => openModal('add-transaction')}
            className="lg:hidden flex items-center gap-1.5 px-4 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            + İşlem
          </button>
        )}
      </div>
    </header>
  )
}
