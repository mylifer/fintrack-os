'use client'

import { useSyncExternalStore } from 'react'

/* ── Telefon genişliği mi? ───────────────────────────────────────────────────
   Eşik Tailwind'in lg kırılımıdır (1024px): lg ve üstü masaüstü düzeni.

   YALNIZCA düzen seçiminde kullanılır — aynı veriyi farklı bir React ağacıyla
   göstermek gerektiğinde (tablo ↔ kart). Gizle/göster ile çözülebilen her yerde
   `lg:` sınıfları tercih edilir: CSS'in kırılımı sunucu render'ında da doğrudur.

   Sunucuda genişlik bilinemez; ilk render masaüstü varsayar ve hydration'dan
   hemen sonra gerçek genişliğe geçilir. */

const QUERY = '(max-width: 1023px)'

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
