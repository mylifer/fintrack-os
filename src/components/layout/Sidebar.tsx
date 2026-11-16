'use client'

import { useSidebarVariant } from '@/components/layout/SidebarVariantProvider'
import { SidebarRefined } from '@/components/layout/sidebar/SidebarRefined'
import { SidebarDual } from '@/components/layout/sidebar/SidebarDual'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

/* Görünüm tercihi Ayarlar > Görünüm'den seçilir, çerezde saklanır ve kök
   layout tarafından sunucuda okunur — bu yüzden burada okunan değer ilk
   render'da zaten doğru (hidrasyon sıçraması yok). */
export function Sidebar() {
  const { variant } = useSidebarVariant()
  return (
    <>
      {variant === 'refined' ? <SidebarRefined /> : <SidebarDual />}
      {/* Ayarlar'da kenar çubuğunun yanında açılan bölüm katmanı */}
      <SettingsPanel />
    </>
  )
}
