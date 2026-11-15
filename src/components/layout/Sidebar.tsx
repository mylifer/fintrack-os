'use client'

import { useSidebarVariant } from '@/components/layout/SidebarVariantProvider'
import { SidebarRefined } from '@/components/layout/sidebar/SidebarRefined'
import { SidebarDual } from '@/components/layout/sidebar/SidebarDual'

/* Görünüm tercihi Ayarlar > Görünüm'den seçilir, çerezde saklanır ve kök
   layout tarafından sunucuda okunur — bu yüzden burada okunan değer ilk
   render'da zaten doğru (hidrasyon sıçraması yok). */
export function Sidebar() {
  const { variant } = useSidebarVariant()
  switch (variant) {
    case 'refined': return <SidebarRefined />
    default:        return <SidebarDual />
  }
}
