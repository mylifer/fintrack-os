'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Factor } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { verifyCurrentPassword, deleteMyAccount } from '@/lib/account'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/Input'

type Panel = 'password' | 'email' | 'delete' | null

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

const DELETE_PHRASE = 'HESABIMI SİL'

export function AccountSettings() {
  const [email, setEmail]     = useState('')
  const [factors, setFactors] = useState<Factor[]>([])
  const [panel, setPanel]     = useState<Panel>(null)

  const loadFactors = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp ?? [])
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!alive) return
      setEmail(user?.email ?? '')
      const { data } = await supabase.auth.mfa.listFactors()
      if (alive) setFactors(data?.totp ?? [])
    })()
    return () => { alive = false }
  }, [])

  function toggle(p: Exclude<Panel, null>) {
    setPanel(cur => (cur === p ? null : p))
  }

  return (
    <Card>
      <CardContent>
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-3">Hesap</div>
        <div className="text-sm font-semibold break-all">{email || '—'}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Giriş yaptığınız e-posta adresi</div>

        <div className="flex flex-col gap-4 mt-4">
          <Row
            title="Şifre"
            description="Şifrenizi değiştirin. Mevcut şifreniz istenir."
            action={<Button size="sm" variant="secondary" className="rounded-xl" onClick={() => toggle('password')}>{panel === 'password' ? 'Kapat' : 'Değiştir'}</Button>}
          >
            {panel === 'password' && <ChangePasswordForm email={email} onDone={() => setPanel(null)} />}
          </Row>

          <Row
            title="E-posta Adresi"
            description="Yeni adrese onay bağlantısı gönderilir; onaylanınca değişir."
            action={<Button size="sm" variant="secondary" className="rounded-xl" onClick={() => toggle('email')}>{panel === 'email' ? 'Kapat' : 'Değiştir'}</Button>}
          >
            {panel === 'email' && <ChangeEmailForm email={email} />}
          </Row>

          <TwoFactorSection factors={factors} reload={loadFactors} />

          <SignOutOthersRow />

          <Row
            title="Hesabı Sil"
            danger
            description="Hesabınızı ve buluttaki tüm verinizi (yedekler dahil) kalıcı olarak siler. Geri alınamaz — önce Yedekler bölümünden bir yedek indirin."
            action={<Button size="sm" variant="secondary" className="rounded-xl" onClick={() => toggle('delete')}>{panel === 'delete' ? 'Kapat' : 'Hesabı Sil'}</Button>}
          >
            {panel === 'delete' && <DeleteAccountForm email={email} />}
          </Row>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Satır iskeleti ───────────────────────────────────────────────────────── */

function Row({ title, description, action, danger, children }: {
  title: string
  description: string
  action?: React.ReactNode
  danger?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="pt-4 border-t border-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`text-sm font-semibold ${danger ? 'text-destructive' : ''}`}>{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

/* ── Şifre değiştir ───────────────────────────────────────────────────────── */

function ChangePasswordForm({ email, onDone }: { email: string; onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState('')
  const [done, setDone]       = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) { setError('Yeni şifreler eşleşmiyor.'); return }
    // Kayıt sayfasıyla aynı istemci kuralı; asıl zorunluluk Supabase politikasında
    if (next.length < 12) { setError('Yeni şifre en az 12 karakter olmalıdır.'); return }

    setLoading(true)
    if (!(await verifyCurrentPassword(email, current))) {
      setError('Mevcut şifre hatalı.')
      setLoading(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: next })
    setLoading(false)
    if (error) {
      setError(error.code === 'same_password' ? 'Yeni şifre eskisiyle aynı olamaz.' : 'Şifre güncellenemedi.')
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="mt-3 text-xs text-green-600">
        Şifreniz güncellendi.{' '}
        <button type="button" onClick={onDone} className="underline">Kapat</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
      <Input label="Mevcut Şifre" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required />
      <Input label="Yeni Şifre" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" hint="En az 12 karakter" required />
      <Input label="Yeni Şifre Tekrar" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" loading={loading} className="self-start rounded-xl px-4">Şifreyi Güncelle</Button>
    </form>
  )
}

/* ── E-posta değiştir ─────────────────────────────────────────────────────── */

function ChangeEmailForm({ email }: { email: string }) {
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [sentTo, setSentTo]     = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const target = newEmail.trim()
    if (target.toLowerCase() === email.toLowerCase()) { setError('Bu zaten mevcut adresiniz.'); return }

    setLoading(true)
    if (!(await verifyCurrentPassword(email, password))) {
      setError('Mevcut şifre hatalı.')
      setLoading(false)
      return
    }
    const { error } = await supabase.auth.updateUser(
      { email: target },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    )
    setLoading(false)
    if (error) { setError('E-posta değiştirilemedi. Adresi kontrol edip tekrar deneyin.'); return }
    setSentTo(target)
  }

  if (sentTo) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{sentTo}</span> adresine onay bağlantısı gönderildi.
        Güvenli e-posta değişikliği açıksa mevcut adresinize de bir onay gelir; ikisi de onaylanınca adres değişir.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
      <Input label="Yeni E-posta" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} autoComplete="email" required />
      <Input label="Mevcut Şifre" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" loading={loading} className="self-start rounded-xl px-4">Onay Bağlantısı Gönder</Button>
    </form>
  )
}

/* ── İki adımlı doğrulama (TOTP) ─────────────────────────────────────────── */

function TwoFactorSection({ factors, reload }: { factors: Factor[]; reload: () => Promise<void> }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode]             = useState('')
  const [error, setError]           = useState('')
  const [busy, setBusy]             = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function startEnroll() {
    setError('')
    setBusy(true)
    // Yarım kalmış (doğrulanmamış) kayıtlar yeni kaydı engelleyebilir — temizle
    const { data: list } = await supabase.auth.mfa.listFactors()
    for (const f of list?.all ?? []) {
      if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: 'FinTrack OS',
      friendlyName: `Doğrulayıcı · ${new Date().toLocaleString('tr-TR')}`,
    })
    setBusy(false)
    if (error || !data) { setError('Kurulum başlatılamadı. Tekrar deneyin.'); return }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (!enrollment) return
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() })
    setBusy(false)
    if (error) { setError('Kod hatalı. Uygulamadaki güncel 6 haneli kodu girin.'); return }
    setEnrollment(null)
    await reload()
  }

  async function cancelEnroll() {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    setEnrollment(null)
    setError('')
  }

  async function remove(factorId: string) {
    const last = factors.length === 1
    if (!window.confirm(last
      ? 'İki adımlı doğrulama kapatılsın mı? Girişte yalnızca şifre istenecek.'
      : 'Bu doğrulayıcı kaldırılsın mı?')) return
    setRemovingId(factorId)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setRemovingId(null)
    if (error) { setError('Kaldırılamadı. Oturumu yenileyip tekrar deneyin.'); return }
    await reload()
  }

  const enabled = factors.length > 0

  return (
    <div className="pt-4 border-t border-border">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">
            İki Adımlı Doğrulama{' '}
            <span className={`ml-1 text-xs font-medium ${enabled ? 'text-green-600' : 'text-muted-foreground'}`}>
              {enabled ? '· Açık' : '· Kapalı'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Girişte şifreye ek olarak doğrulama uygulamasındaki (Google Authenticator, Authy vb.) kod istenir.
          </div>
        </div>
        {!enrollment && (
          <Button size="sm" variant="secondary" className="rounded-xl flex-shrink-0" onClick={startEnroll} loading={busy}>
            {enabled ? 'Cihaz Ekle' : 'Aç'}
          </Button>
        )}
      </div>

      {enabled && (
        <div className="mt-3 flex flex-col gap-2">
          {factors.map(f => (
            <div key={f.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-foreground truncate">{f.friendly_name || 'Doğrulayıcı'}</span>
              <Button size="sm" variant="ghost" className="h-7 rounded-lg text-destructive" loading={removingId === f.id} onClick={() => remove(f.id)}>
                Kaldır
              </Button>
            </div>
          ))}
          {factors.length === 1 && (
            <p className="text-xs text-muted-foreground">
              Telefonunuzu kaybederseniz hesabınıza giremezsiniz. Yedek olarak ikinci bir cihaz eklemeniz önerilir.
            </p>
          )}
        </div>
      )}

      {enrollment && (
        <form onSubmit={confirmEnroll} className="mt-3 flex flex-col gap-3 rounded-lg bg-background px-3 py-3">
          <div className="text-xs text-muted-foreground">
            1. Doğrulama uygulamanızla bu QR kodu okutun.
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase'in ürettiği data: URI SVG; next/image optimizasyonu uygulanamaz */}
          <img src={enrollment.qrCode} alt="İki adımlı doğrulama QR kodu" className="size-44 self-center rounded-lg bg-white p-2" />
          <div className="text-xs text-muted-foreground">
            Okutamıyorsanız bu anahtarı elle girin:{' '}
            <span className="font-mono text-foreground break-all select-all">{enrollment.secret}</span>
          </div>
          <Input
            label="2. Uygulamadaki 6 haneli kod"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" loading={busy} disabled={code.length !== 6} className="rounded-xl px-4">Doğrula ve Aç</Button>
            <Button type="button" size="sm" variant="secondary" className="rounded-xl" onClick={cancelEnroll}>İptal</Button>
          </div>
        </form>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

/* ── Diğer cihazlardan çıkış ─────────────────────────────────────────────── */

function SignOutOthersRow() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function handleClick() {
    setState('busy')
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    setState(error ? 'error' : 'done')
  }

  return (
    <div className="pt-4 border-t border-border flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-semibold">Diğer Cihazlar</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {state === 'done'
            ? 'Bu cihaz dışındaki tüm oturumlar kapatıldı.'
            : state === 'error'
              ? 'Oturumlar kapatılamadı. Tekrar deneyin.'
              : 'Kaybolan bir telefon ya da paylaşılan bir bilgisayardaki oturumları kapatın.'}
        </div>
      </div>
      <Button size="sm" variant="secondary" className="rounded-xl flex-shrink-0" loading={state === 'busy'} disabled={state === 'done'} onClick={handleClick}>
        Hepsinden Çıkış Yap
      </Button>
    </div>
  )
}

/* ── Hesabı sil ───────────────────────────────────────────────────────────── */

function DeleteAccountForm({ email }: { email: string }) {
  const [phrase, setPhrase]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const phraseOk = phrase.trim().toLocaleUpperCase('tr-TR') === DELETE_PHRASE

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!phraseOk) return
    setError('')
    setLoading(true)
    if (!(await verifyCurrentPassword(email, password))) {
      setError('Mevcut şifre hatalı.')
      setLoading(false)
      return
    }
    try {
      await deleteMyAccount()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hesap silinemedi. Hiçbir veri silinmedi.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 rounded-lg bg-background px-3 py-3">
      <div className="text-xs text-muted-foreground">
        Onaylamak için <span className="font-mono font-bold text-destructive">{DELETE_PHRASE}</span> yazın:
      </div>
      <Input value={phrase} onChange={e => setPhrase(e.target.value)} placeholder={DELETE_PHRASE} className="font-mono" autoFocus />
      <Input label="Mevcut Şifre" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" variant="danger" loading={loading} disabled={!phraseOk} className="self-start rounded-xl px-4">
        Hesabımı Kalıcı Olarak Sil
      </Button>
    </form>
  )
}
