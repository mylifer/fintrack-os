'use client'

import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { openCommandPalette } from '@/components/layout/command-palette/useCommandPalette'

/* Kenar çubuğu lg altında gizlendiği için çalışma alanı geçişi mobilde buradan
   gelir. Header her sayfada kullanılmadığından (Yatırımlar, detay sayfaları)
   layout seviyesinde durur. Sticky değil — kaydırınca çekilir, sayfanın sticky
   Header'ı yerini alır.

   Genel arama, bildirim zili ve gizlilik düğmesi de burada: masaüstünde ikisi
   Header'ın sağ ucunda duruyor ama Header'ı olmayan sayfalarda mobilde hiç
   görünmüyorlardı; arama ise yalnız alt menüdeki "Diğer" sayfasının içinden
   açılabiliyordu. Burada oldukları için her sayfada tek dokunuş uzaktalar ve
   Header mobilde başlık + sayfanın kendi eylemiyle kalır. */
export function MobileTopBar() {
  return (
    <div className="lg:hidden print:hidden h-11 box-content pt-[var(--safe-top)] flex-shrink-0 flex items-center gap-1 px-3 border-b border-border bg-background">
      <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-black text-[11px] select-none flex-shrink-0">
        F
      </div>
      <div className="flex-1 min-w-0 max-w-64">
        <WorkspaceSwitcher />
      </div>
      <span className="flex-1" />
      <button
        type="button"
        onClick={openCommandPalette}
        className="w-10 h-10 flex items-center justify-center rounded-xl text-muted-foreground active:bg-secondary/60 transition-colors"
        aria-label="Ara"
        title="Ara"
      >
        <Icon d={IC.search} size={19} />
      </button>
      <NotificationBell />
      <PrivacyToggle className="w-10 h-10 rounded-xl" />
    </div>
  )
}
