'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/Input'
import { SelectField } from '@/components/ui/Select'
import { usePrivacyStore } from '@/store/privacy.store'
import { useAppLockStore } from '@/store/app-lock.store'
import { PIN_PATTERN } from '@/lib/app-lock'

const TIMEOUT_OPTIONS = [
  { value: '0',  label: 'Uygulamadan çıkınca hemen' },
  { value: '1',  label: '1 dakika sonra' },
  { value: '5',  label: '5 dakika sonra' },
  { value: '15', label: '15 dakika sonra' },
]

export function PrivacySettings() {
  const hideAmounts    = usePrivacyStore(s => s.hideAmounts)
  const setHideAmounts = usePrivacyStore(s => s.setHideAmounts)
  const onlineLogos    = usePrivacyStore(s => s.onlineLogos)
  const setOnlineLogos = usePrivacyStore(s => s.setOnlineLogos)

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-4">Gizlilik</div>
        <div className="flex flex-col gap-4">
          <ToggleRow
            title="Tutarları gizle"
            description="Tüm tutarlar ₺••• olarak görünür — kalabalıkta ya da ekran paylaşırken. Üst çubuktaki göz simgesiyle de açılıp kapanır."
            checked={hideAmounts}
            onChange={setHideAmounts}
          />
          <ToggleRow
            title="İnternetten logo getir"
            description="Alıcı adları logo bulmak için Clearbit/Wikidata'ya, alan adları simge için Google'a gönderilir. Kapalıyken hiçbir ad dışarı çıkmaz, baş harf gösterilir. İşlem açıklamaları hiçbir durumda gönderilmez."
            checked={onlineLogos}
            onChange={setOnlineLogos}
          />
          <AppLockRow />
        </div>
      </CardContent>
    </Card>
  )
}

function ToggleRow({ title, description, checked, onChange }: {
  title: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
      />
    </label>
  )
}

function AppLockRow() {
  const pinHash       = useAppLockStore(s => s.pinHash)
  const timeoutMin    = useAppLockStore(s => s.timeoutMin)
  const setPin        = useAppLockStore(s => s.setPin)
  const clearPin      = useAppLockStore(s => s.clearPin)
  const unlock        = useAppLockStore(s => s.unlock)
  const lock          = useAppLockStore(s => s.lock)
  const setTimeoutMin = useAppLockStore(s => s.setTimeoutMin)

  const [mode, setMode]       = useState<'idle' | 'set' | 'remove'>('idle')
  const [current, setCurrent] = useState('')
  const [pin, setPinStr]      = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState('')
  const [busy, setBusy]       = useState(false)

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8)

  function close() {
    setMode('idle'); setCurrent(''); setPinStr(''); setConfirm(''); setError('')
  }

  async function handleSet(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pinHash && !(await unlock(current))) { setError('Mevcut PIN hatalı.'); return }
    if (!PIN_PATTERN.test(pin)) { setError('PIN 4–8 rakam olmalı.'); return }
    if (pin !== confirm) { setError('PIN\'ler eşleşmiyor.'); return }
    setBusy(true)
    await setPin(pin)
    setBusy(false)
    close()
  }

  async function handleRemove(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await unlock(current)
    setBusy(false)
    if (!ok) { setError('PIN hatalı.'); return }
    clearPin()
    close()
  }

  return (
    <div className="pt-4 border-t border-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">
            Uygulama kilidi (PIN){' '}
            <span className={`ml-1 text-xs font-medium ${pinHash ? 'text-green-600' : 'text-muted-foreground'}`}>
              {pinHash ? '· Açık' : '· Kapalı'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Açılışta ve uygulamaya geri dönüldüğünde PIN istenir. Bu cihaza özeldir ve çıkış yapınca silinir;
            PIN&apos;i unutursanız çıkış yapıp şifrenizle girin.
          </div>
        </div>
        {mode === 'idle' && (
          <div className="flex gap-2 flex-shrink-0">
            {pinHash && <Button size="sm" variant="ghost" className="rounded-xl" onClick={lock}>Şimdi Kilitle</Button>}
            <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setMode('set')}>
              {pinHash ? 'Değiştir' : 'PIN Belirle'}
            </Button>
          </div>
        )}
      </div>

      {pinHash && mode === 'idle' && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground flex-shrink-0">Kilitlenme</span>
          <SelectField
            value={String(timeoutMin)}
            onChange={e => setTimeoutMin(Number(e.target.value))}
            options={TIMEOUT_OPTIONS}
            className="flex-1 max-w-64 text-xs"
          />
          <button type="button" onClick={() => setMode('remove')} className="text-xs text-destructive hover:underline flex-shrink-0">
            Kilidi kaldır
          </button>
        </div>
      )}

      {mode === 'set' && (
        <form onSubmit={handleSet} className="mt-3 flex flex-col gap-3 rounded-lg bg-background px-3 py-3">
          {pinHash && (
            <Input label="Mevcut PIN" type="password" inputMode="numeric" value={current} onChange={e => setCurrent(digits(e.target.value))} autoFocus />
          )}
          <Input label="Yeni PIN (4–8 rakam)" type="password" inputMode="numeric" value={pin} onChange={e => setPinStr(digits(e.target.value))} autoFocus={!pinHash} />
          <Input label="Yeni PIN tekrar" type="password" inputMode="numeric" value={confirm} onChange={e => setConfirm(digits(e.target.value))} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy} className="rounded-xl px-4">Kaydet</Button>
            <Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={close}>İptal</Button>
          </div>
        </form>
      )}

      {mode === 'remove' && (
        <form onSubmit={handleRemove} className="mt-3 flex flex-col gap-3 rounded-lg bg-background px-3 py-3">
          <Input label="Mevcut PIN" type="password" inputMode="numeric" value={current} onChange={e => setCurrent(digits(e.target.value))} autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" loading={busy} className="rounded-xl px-4">Kilidi Kaldır</Button>
            <Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={close}>İptal</Button>
          </div>
        </form>
      )}
    </div>
  )
}
