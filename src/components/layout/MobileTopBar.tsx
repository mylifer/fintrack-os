'use client'

import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'

/* Kenar çubuğu lg altında gizlendiği için çalışma alanı geçişi mobilde buradan
   gelir. Header her sayfada kullanılmadığından (Yatırımlar, detay sayfaları)
   layout seviyesinde durur. Sticky değil — kaydırınca çekilir, sayfanın sticky
   Header'ı yerini alır. Görünüm Kompakt kenar çubuğunun üst şeridiyle aynı. */
export function MobileTopBar() {
  return (
    <div className="lg:hidden h-11 flex-shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
      <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-black text-[11px] select-none flex-shrink-0">
        F
      </div>
      <div className="flex-1 min-w-0 max-w-64">
        <WorkspaceSwitcher />
      </div>
      <span className="flex-1" />
      <PrivacyToggle className="w-9 h-9" />
    </div>
  )
}
