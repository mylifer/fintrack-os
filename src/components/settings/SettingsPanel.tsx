'use client'

import { usePathname } from 'next/navigation'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { SettingsSectionList } from './SettingsSectionNav'

/* ── Ayarlar ek katmanı ──────────────────────────────────────────────────
   Ayarlar sayfasındayken kenar çubuğunun HEMEN YANINDA açılan ikinci bir
   sütun. Kenar çubuğunun yerini almaz ve durum tutmaz: görünürlüğü yalnızca
   yoldan çıkar, bu yüzden Ayarlar'a her girişte açık, çıkışta kapalıdır.
   Yalnızca geniş ekranda; dar ekranda sayfadaki çipler kullanılır. */

const rowCls = (active: boolean) => [
  'flex items-center gap-2.5 w-full h-9 px-2.5 rounded-lg text-[13px] transition-colors duration-100',
  active
    ? 'bg-primary/10 text-foreground font-semibold'
    : 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/60',
].join(' ')

export function SettingsPanel() {
  const pathname = usePathname()
  if (pathname !== '/settings') return null

  return (
    <aside
      aria-label="Ayarlar bölümleri"
      className="hidden lg:flex print:hidden flex-col w-56 h-screen sticky top-0 shrink-0 bg-muted/30 border-r border-border"
    >
      <div className="px-4 pt-5 pb-3 flex items-center gap-2 text-[15px] font-bold tracking-tight text-foreground flex-shrink-0">
        <Icon d={IC.settings} size={17} className="text-primary" />
        Ayarlar
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-4 flex flex-col gap-0.5">
        <SettingsSectionList rowCls={rowCls} />
      </nav>
    </aside>
  )
}
