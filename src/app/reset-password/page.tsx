'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { enterApp, needsMfaStep } from '@/lib/auth'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'
import { MfaCodeForm } from '@/components/auth/MfaCodeForm'

type Step = 'checking' | 'invalid' | 'mfa' | 'form'

/* /auth/callback, sıfırlama bağlantısındaki kodu kurtarma oturumuna çevirip
   buraya yönlendirir. Oturum yoksa bağlantı ya hiç açılmamış ya da süresi
   geçmiştir. İki adımlı doğrulama açık hesaplarda kurtarma oturumu aal1'dir;
   şifre değişikliğinden ÖNCE kod istenir — aksi halde yalnız e-postaya erişen
   biri ikinci adımı atlayarak hesabı ele geçirebilirdi. */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [step, setStep]         = useState<Step>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!alive) return
      if (!session) { setStep('invalid'); return }
      const mfa = await needsMfaStep()
      if (alive) setStep(mfa ? 'mfa' : 'form')
    })()
    return () => { alive = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) { setError('Şifreler eşleşmiyor.'); return }
    if (password.length < 12) { setError('Şifre en az 12 karakter olmalıdır.'); return }

    setLoading(true)
    const { data, error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.code === 'same_password'
        ? 'Yeni şifre eskisiyle aynı olamaz.'
        : 'Şifre güncellenemedi. Bağlantının süresi dolmuş olabilir; yeniden isteyin.')
      setLoading(false)
      return
    }

    await enterApp(data.user?.id, href => router.push(href), 'reset-password')
  }

  if (step === 'checking') return null

  if (step === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold text-foreground mb-2">Bağlantı geçersiz</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Şifre sıfırlama bağlantısının süresi dolmuş ya da bağlantı başka bir tarayıcıda açılmış.
          </p>
          <Link href="/forgot-password" className="text-sm text-foreground font-medium hover:underline">
            Yeni bağlantı iste →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Yeni Şifre Belirle</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {step === 'mfa'
              ? 'Devam etmek için önce doğrulama kodunu girin'
              : 'Hesabınız için yeni bir şifre seçin'}
          </p>
        </div>

        {step === 'mfa' ? (
          <MfaCodeForm onVerified={() => setStep('form')} submitLabel="Devam Et" />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Yeni Şifre"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              hint="En az 12 karakter"
              required
            />
            <Input
              label="Yeni Şifre Tekrar"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button type="submit" loading={loading} fullWidth className="mt-1">
              Şifreyi Güncelle
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
