'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message === 'Email not confirmed') {
        setError('E-posta adresiniz henüz doğrulanmadı. Gelen kutunuzu kontrol edin.')
      } else {
        setError('E-posta veya şifre hatalı.')
      }
      setLoading(false)
      return
    }

    router.push('/dashboard')
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
          <Input
            label="Şifre"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

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
