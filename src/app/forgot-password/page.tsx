'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Bağlantı /auth/callback'e döner; o da kodu oturuma çevirip (PKCE —
    // doğrulayıcı bu tarayıcının çerezinde) /reset-password'e yönlendirir.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setLoading(false)
    // Sonuç ne olursa olsun AYNI ekran: "böyle bir hesap yok" demek kullanıcı
    // sayımına kapı açar (giriş/kayıt sayfalarındaki jenerik hata kuralı).
    setSent(true)
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="text-4xl mb-4">✉️</div>
          <h1 className="text-xl font-semibold text-foreground mb-2">E-postanızı kontrol edin</h1>
          <p className="text-sm text-muted-foreground mb-6">
            <span className="font-medium text-foreground">{email}</span> ile kayıtlı bir hesap varsa
            şifre sıfırlama bağlantısı gönderdik. Bağlantıyı <span className="font-medium text-foreground">bu tarayıcıda</span> açın.
          </p>
          <Link href="/login" className="text-sm text-foreground font-medium hover:underline">
            Giriş sayfasına dön →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Şifremi Unuttum</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hesabınızın e-posta adresini girin, size bir sıfırlama bağlantısı gönderelim.
          </p>
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

          <Button type="submit" loading={loading} fullWidth className="mt-1">
            Sıfırlama Bağlantısı Gönder
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Şifrenizi hatırladınız mı?{' '}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Giriş Yap
          </Link>
        </p>
      </div>
    </div>
  )
}
