'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import {
  DEFAULT_INVESTMENTS_VIEW,
  INVESTMENTS_VIEW_COOKIE,
  type InvestmentsView,
} from '@/lib/investments-view'

interface Ctx {
  view: InvestmentsView
  setView: (v: InvestmentsView) => void
}

// Varsayılan bağlam yalnızca sağlayıcı dışında (test/izole render) devreye girer.
const InvestmentsViewContext = createContext<Ctx>({
  view: DEFAULT_INVESTMENTS_VIEW,
  setView: () => {},
})

const ONE_YEAR = 60 * 60 * 24 * 365

/* İlk değer sunucudan prop olarak gelir; sunucu HTML'i ile ilk istemci render'ı
   birebir aynı olur. Tercih tek yerde durduğu için Yatırımlar sayfasındaki
   segment seçici ile Ayarlar kartı aynı değeri paylaşır. */
export function InvestmentsViewProvider({
  initial,
  children,
}: {
  initial: InvestmentsView
  children: React.ReactNode
}) {
  const [view, setState] = useState<InvestmentsView>(initial)

  const setView = useCallback((next: InvestmentsView) => {
    setState(next)
    try {
      document.cookie = `${INVESTMENTS_VIEW_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
    } catch (err) {
      // Çerez yazılamazsa (özel mod vb.) tercih yalnızca bu oturum için geçerli olur.
      console.error('[investments-view:persist]', err)
    }
  }, [])

  const value = useMemo(() => ({ view, setView }), [view, setView])

  return (
    <InvestmentsViewContext.Provider value={value}>
      {children}
    </InvestmentsViewContext.Provider>
  )
}

export function useInvestmentsView() {
  return useContext(InvestmentsViewContext)
}
