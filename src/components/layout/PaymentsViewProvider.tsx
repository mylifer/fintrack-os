'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DEFAULT_PAYMENTS_VIEW,
  PAYMENTS_VIEW_COOKIE,
  type PaymentsView,
} from '@/lib/payments-view'

interface Ctx {
  view: PaymentsView
  setView: (v: PaymentsView) => void
}

// Varsayılan bağlam yalnızca sağlayıcı dışında (test/izole render) devreye girer.
const PaymentsViewContext = createContext<Ctx>({
  view: DEFAULT_PAYMENTS_VIEW,
  setView: () => {},
})

const ONE_YEAR = 60 * 60 * 24 * 365

/* İlk değer sunucudan prop olarak gelir (bkz. InvestmentsViewProvider — aynı
   kalıp); sunucu HTML'i ile ilk istemci render'ı birebir aynı olur. */
export function PaymentsViewProvider({
  initial,
  children,
}: {
  initial: PaymentsView
  children: React.ReactNode
}) {
  const [view, setState] = useState<PaymentsView>(initial)

  const setView = useCallback((next: PaymentsView) => {
    setState(next)
    try {
      document.cookie = `${PAYMENTS_VIEW_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
    } catch (err) {
      // Çerez yazılamazsa (özel mod vb.) tercih yalnızca bu oturum için geçerli olur.
      console.error('[payments-view:persist]', err)
    }
  }, [])

  const value = useMemo(() => ({ view, setView }), [view, setView])

  return (
    <PaymentsViewContext.Provider value={value}>
      {children}
    </PaymentsViewContext.Provider>
  )
}

export function usePaymentsView() {
  return useContext(PaymentsViewContext)
}
