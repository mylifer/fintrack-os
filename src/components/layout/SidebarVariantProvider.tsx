'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DEFAULT_SIDEBAR_VARIANT,
  SIDEBAR_VARIANT_COOKIE,
  type SidebarVariant,
} from '@/lib/sidebar-variant'

interface Ctx {
  variant: SidebarVariant
  setVariant: (v: SidebarVariant) => void
}

// Varsayılan bağlam yalnızca sağlayıcı dışında (test/izole render) devreye girer.
const SidebarVariantContext = createContext<Ctx>({
  variant: DEFAULT_SIDEBAR_VARIANT,
  setVariant: () => {},
})

const ONE_YEAR = 60 * 60 * 24 * 365

/* İlk değer sunucudan prop olarak gelir; bu yüzden sunucu HTML'i ile ilk
   istemci render'ı birebir aynıdır — hidrasyon uyuşmazlığı yok, sıçrama yok.
   Değişiklik hem state'i günceller (anında yeniden render) hem de çerezi yazar
   (sonraki tam sayfa yüklemelerinde sunucu doğru varyantı basar). */
export function SidebarVariantProvider({
  initial,
  children,
}: {
  initial: SidebarVariant
  children: React.ReactNode
}) {
  const [variant, setState] = useState<SidebarVariant>(initial)

  const setVariant = useCallback((next: SidebarVariant) => {
    setState(next)
    try {
      document.cookie = `${SIDEBAR_VARIANT_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
    } catch (err) {
      // Çerez yazılamazsa (özel mod vb.) tercih yalnızca bu oturum için geçerli olur.
      console.error('[sidebar-variant:persist]', err)
    }
  }, [])

  const value = useMemo(() => ({ variant, setVariant }), [variant, setVariant])

  return (
    <SidebarVariantContext.Provider value={value}>
      {children}
    </SidebarVariantContext.Provider>
  )
}

export function useSidebarVariant() {
  return useContext(SidebarVariantContext)
}
