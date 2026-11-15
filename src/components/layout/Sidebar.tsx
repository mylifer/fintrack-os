'use client'

import { useSidebarVariant } from '@/components/layout/SidebarVariantProvider'
import { SidebarCompact } from '@/components/layout/sidebar/SidebarCompact'
import { SidebarRefined } from '@/components/layout/sidebar/SidebarRefined'
import { SidebarFloating } from '@/components/layout/sidebar/SidebarFloating'
import { SidebarContrast } from '@/components/layout/sidebar/SidebarContrast'
import { SidebarRail } from '@/components/layout/sidebar/SidebarRail'
import { SidebarDual } from '@/components/layout/sidebar/SidebarDual'

/* Görünüm tercihi Ayarlar > Görünüm'den seçilir, çerezde saklanır ve kök
   layout tarafından sunucuda okunur — bu yüzden burada okunan değer ilk
   render'da zaten doğru (hidrasyon sıçraması yok). */
export function Sidebar() {
  const { variant } = useSidebarVariant()
  switch (variant) {
    case 'refined':  return <SidebarRefined />
    case 'floating': return <SidebarFloating />
    case 'contrast': return <SidebarContrast />
    case 'rail':     return <SidebarRail />
    case 'dual':     return <SidebarDual />
    default:         return <SidebarCompact />
  }
}
