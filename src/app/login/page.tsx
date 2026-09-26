'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { enterApp, needsMfaStep } from '@/lib/auth'
import { safeInviteNext } from '@/lib/sharing'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'
import { MfaCodeForm } from '@/components/auth/MfaCodeForm'

// /auth/callback bir e-posta bağlantısını çözemezse buraya ?error= ile döner
const CALLBACK_ERRORS: Record<string, string> = {
  link: 'Bağlantı geçersiz ya da süresi dolmuş. Bağlantıyı isteğin yapıldığı tarayıcıda açın veya yeniden isteyin.',
}

export default function LoginPage() {
  // useSearchParams statik ön-render'da Suspense sınırı ister (Next 16)
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Yalnız /davet/<token> — başka her adres yok sayılır (açık yönlendirme yok)
  const inviteNext = safeInviteNext(searchParams.get('next'))
  const [step, setStep]         = useState<'password' | 'mfa'>('password')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(() => CALLBACK_ERRORS[searchParams.get('error') ?? ''] ?? '')
  const [loading, setLoading]   = useState(false)

  // Proxy, doğrulama adımı yarım kalmış (aal1) oturumları buraya gönderir:
  // şifreyi yeniden sormadan doğrudan kod adımını aç.
  useEffect(() => {
    let alive = true
    needsMfaStep().then(needs => { if (alive && needs) setStep('mfa') })
    return () => { alive = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Hesabın var olup olmadığını sızdırmamak için tüm hatalar tek bir
      // jenerik mesaja indirgenir (ör. "Email not confirmed" ile kullanıcı
      // sayımı yapılamaz).
      setError('E-posta veya şifre hatalı.')
      setLoading(false)
      return
    }

    // İki adımlı doğrulama açıksa oturum henüz aal1: veriye (RLS) ve uygulamaya
    // (proxy) erişim kod girilene kadar kapalı.
    if (await needsMfaStep()) {
      setStep('mfa')
      setLoading(false)
      return
    }

    await enterApp(data.user?.id, href => router.push(href), 'login', inviteNext ?? undefined)
  }

  async function handleMfaVerified() {
    const { data: { user } } = await supabase.auth.getUser()
    await enterApp(user?.id, href => router.push(href), 'login', inviteNext ?? undefined)
  }

  async function handleMfaCancel() {
    await supabase.auth.signOut({ scope: 'local' })
    setPassword('')
    setStep('password')
  }

  if (step === 'mfa') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground">İki Adımlı Doğrulama</h1>
            <p className="text-sm text-muted-foreground mt-1">Girişi tamamlamak için doğrulama kodunu girin</p>
          </div>
          <MfaCodeForm onVerified={handleMfaVerified} onCancel={handleMfaCancel} submitLabel="Giriş Yap" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Giriş Yap</h1>
          <p className="text-sm text-muted-foreground mt-1">FinTrack OS hesabınıza girin</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="E-posta"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ornek@email.com"
            autoComplete="email"
            required
          />
          <div className="flex flex-col gap-1.5">
            <Input
              label="Şifre"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
            <Link href="/forgot-password" className="self-end text-xs text-muted-foreground hover:text-foreground hover:underline">
              Şifremi unuttum
            </Link>
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          <Button type="submit" loading={loading} fullWidth className="mt-1">
            Giriş Yap
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Hesabınız yok mu?{' '}
          <Link href="/register" className="text-foreground font-medium hover:underline">
            Kayıt Ol
          </Link>
        </p>
      </div>
    </div>
  )
}
