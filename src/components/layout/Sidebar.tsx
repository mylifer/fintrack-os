'use client'

import { useSidebarVariant } from '@/components/layout/SidebarVariantProvider'
import { SidebarCompact } from '@/components/layout/sidebar/SidebarCompact'
import { SidebarRefined } from '@/components/layout/sidebar/SidebarRefined'

/* Görünüm tercihi Ayarlar > Görünüm'den seçilir, çerezde saklanır ve kök
   layout tarafından sunucuda okunur — bu yüzden burada okunan değer ilk
   render'da zaten doğru (hidrasyon sıçraması yok). */
export function Sidebar() {
  const { variant } = useSidebarVariant()
  return variant === 'refined' ? <SidebarRefined /> : <SidebarCompact />
}
