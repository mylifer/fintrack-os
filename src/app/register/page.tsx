'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) { setError('Şifreler eşleşmiyor.'); return }
    // Sunucu tarafı zorunluluk Supabase proje şifre politikasıyla uygulanır;
    // buradaki kontrol yalnızca istemci UX'i içindir.
    if (password.length < 12) { setError('Şifre en az 12 karakter olmalıdır.'); return }

    setLoading(true)
    const { data, error } = await supabase.auth.signUp({ email, password })
    setLoading(false)

    if (error) {
      // Ham Supabase mesajını UI'a sızdırma; "user already registered" gibi
      // hesap sayımına imkan veren yanıtları jenerik bir mesaja indirge.
      setError('Kayıt oluşturulamadı. Bilgilerinizi kontrol edip tekrar deneyin.')
      return
    }

    // session null ise mail onayı bekleniyor
    if (data.session) {
      router.push('/dashboard')
    } else {
      setEmailSent(true)
    }
  }

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-4xl mb-4">✉️</div>
          <h1 className="text-xl font-semibold text-foreground mb-2">E-postanızı doğrulayın</h1>
          <p className="text-sm text-muted-foreground mb-6">
            <span className="font-medium text-foreground">{email}</span> adresine bir doğrulama linki gönderdik.
            Linke tıkladıktan sonra giriş yapabilirsiniz.
          </p>
          <Link href="/login" className="text-sm text-foreground font-medium hover:underline">
            Giriş Yap →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Kayıt Ol</h1>
          <p className="text-sm text-muted-foreground mt-1">Yeni bir FinTrack OS hesabı oluşturun</p>
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
          <Input
            label="Şifre"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
          <Input
            label="Şifre Tekrar"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button type="submit" loading={loading} fullWidth className="mt-1">
            Hesap Oluştur
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Zaten hesabınız var mı?{' '}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Giriş Yap
          </Link>
        </p>
      </div>
    </div>
  )
}
