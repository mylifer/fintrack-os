'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppLockStore } from '@/store/app-lock.store'
import { handleSignOut } from '@/components/layout/sidebar/useSidebarData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'

/* PIN açıksa uygulamanın üstüne tam ekran kilit perdesi çeker (bkz.
   store/app-lock.store). Altındaki uygulama DOM'da kalır ama `inert` olur:
   klavye ya da ekran okuyucu perdenin arkasına geçemez. Kilit açılışta ve
   sekme arka planda ayarlı süreden uzun kalınca devreye girer. */

const subscribe = (cb: () => void) => useAppLockStore.subscribe(cb)
const isLockedNow = () => {
  const s = useAppLockStore.getState()
  return !!s.pinHash && s.locked
}
// Sunucuda PIN bilinmez → kilitsiz render; istemci hidrasyondan sonra kilitler.
const serverLocked = () => false

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const locked = useSyncExternalStore(subscribe, isLockedNow, serverLocked)

  useEffect(() => {
    const onVisibility = () => {
      const s = useAppLockStore.getState()
      if (document.visibilityState === 'hidden') s.markHidden()
      else s.checkResume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  return (
    <>
      <div inert={locked} aria-hidden={locked || undefined}>{children}</div>
      {locked && <LockScreen />}
    </>
  )
}

function LockScreen() {
  const unlock = useAppLockStore(s => s.unlock)
  const [pin, setPin]         = useState('')
  const [error, setError]     = useState('')
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    const ok = await unlock(pin)
    setChecking(false)
    if (!ok) {
      setError('PIN hatalı.')
      setPin('')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Uygulama kilitli"
      className="fixed inset-0 z-[100] bg-background flex items-center justify-center px-4"
    >
      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col gap-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl" aria-hidden>
          🔒
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">FinTrack OS kilitli</h1>
          <p className="text-sm text-muted-foreground mt-1">Devam etmek için PIN&apos;inizi girin</p>
        </div>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setError('') }}
          aria-label="PIN"
          className="text-center tracking-[0.5em] text-lg h-11"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" loading={checking} disabled={pin.length < 4} fullWidth>Kilidi Aç</Button>
        <button
          type="button"
          onClick={() => { void handleSignOut() }}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          PIN&apos;i unuttum — çıkış yapıp şifreyle gir
        </button>
      </form>
    </div>
  )
}
