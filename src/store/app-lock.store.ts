'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { hashPin, verifyPin } from '@/lib/app-lock'

/* ── Uygulama kilidi (PIN) ──────────────────────────────────────────────────
   PIN açıksa uygulama her açılışta ve arka planda `timeoutMin` dakikadan uzun
   kalınca kilitlenir (AppLockGate). PIN yalnız özet olarak saklanır
   (lib/app-lock). Anahtar DEVICE_KEYS'te DEĞİL: çıkışta silinir — paylaşılan
   bir cihazda sonraki kullanıcı öncekinin kilidiyle karşılaşmasın; "PIN'i
   unuttum" yolu da budur (çıkış yap → şifreyle gir). */

interface AppLockState {
  pinHash: string | null
  salt: string | null
  timeoutMin: number
  /** Çalışma zamanı — kalıcı değil. Açılışta PIN varsa kilitli başlar. */
  locked: boolean
  hiddenAt: number | null
  setPin: (pin: string) => Promise<void>
  clearPin: () => void
  unlock: (pin: string) => Promise<boolean>
  lock: () => void
  setTimeoutMin: (min: number) => void
  markHidden: () => void
  /** Sekmeye dönüldüğünde: arka planda süre dolduysa kilitler. */
  checkResume: () => void
}

export const useAppLockStore = create<AppLockState>()(
  persist(
    (set, get) => ({
      pinHash: null,
      salt: null,
      timeoutMin: 1,
      locked: true,
      hiddenAt: null,

      setPin: async pin => {
        const { hash, salt } = await hashPin(pin)
        set({ pinHash: hash, salt, locked: false })
      },
      clearPin: () => set({ pinHash: null, salt: null, locked: false }),
      unlock: async pin => {
        const { pinHash, salt } = get()
        if (!pinHash || !salt) { set({ locked: false }); return true }
        const ok = await verifyPin(pin, pinHash, salt)
        if (ok) set({ locked: false, hiddenAt: null })
        return ok
      },
      lock: () => { if (get().pinHash) set({ locked: true }) },
      setTimeoutMin: min => set({ timeoutMin: Math.max(0, min) }),
      markHidden: () => set({ hiddenAt: Date.now() }),
      checkResume: () => {
        const { pinHash, hiddenAt, timeoutMin } = get()
        if (!pinHash || hiddenAt === null) return
        if (Date.now() - hiddenAt >= timeoutMin * 60_000) set({ locked: true })
        set({ hiddenAt: null })
      },
    }),
    {
      name: 'fintrack-app-lock',
      partialize: s => ({ pinHash: s.pinHash, salt: s.salt, timeoutMin: s.timeoutMin }),
    },
  ),
)
