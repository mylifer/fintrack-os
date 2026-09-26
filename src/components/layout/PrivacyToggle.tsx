'use client'

import { Fragment, useSyncExternalStore } from 'react'
import { usePrivacyStore } from '@/store/privacy.store'
import { setAmountsHidden } from '@/lib/utils/currency'

const EYE     = 'M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
const EYE_OFF = 'M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88'

const subscribe = (cb: () => void) => usePrivacyStore.subscribe(cb)
const getHidden = () => usePrivacyStore.getState().hideAmounts
// Sunucu (ve hidrasyon) anlık görüntüsü: tercih bilinmez → açık. İstemci
// hidrasyondan hemen sonra kayıtlı tercihe geçer; SSR HTML'iyle çakışma olmaz.
const getServerHidden = () => false

function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, getHidden, getServerHidden)
}

/** Tutarları gizle tercihini biçimlendiricilere uygular. Değişince gövde
 *  yeniden kurulur: bileşenlerin bellekteki (useMemo) biçimlenmiş tutarları
 *  da yenilenir. Veri store'ları etkilenmez (DataProvider dışarıda). */
export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const hidden = useAmountsHidden()
  // Çocuklar biçimlendirmeden ÖNCE bayrak ayarlanmalı; işlem idempotent.
  setAmountsHidden(hidden)
  return <Fragment key={hidden ? 'masked' : 'plain'}>{children}</Fragment>
}

export function PrivacyToggle({ className = '' }: { className?: string }) {
  const hidden = useAmountsHidden()
  const setHidden = usePrivacyStore(s => s.setHideAmounts)
  const label = hidden ? 'Tutarları göster' : 'Tutarları gizle'
  return (
    <button
      type="button"
      onClick={() => setHidden(!hidden)}
      className={`w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={hidden}
    >
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={18} height={18} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d={hidden ? EYE_OFF : EYE} />
      </svg>
    </button>
  )
}
