'use client'

import { useEffect } from 'react'

// Service worker kaydı — yalnızca production'da (dev'de HMR ile çakışır).
// updateViaCache: 'none' → tarayıcı sw.js'i her kontrolde ağdan doğrular,
// yeni sürüm skipWaiting ile hemen devreye girer.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((err) => console.warn('SW kaydı başarısız:', err))
  }, [])

  return null
}
