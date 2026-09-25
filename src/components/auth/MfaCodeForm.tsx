'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/button'

interface Props {
  /** Kod doğrulanıp oturum aal2'ye yükseldikten sonra çağrılır */
  onVerified: () => void | Promise<void>
  /** "Farklı hesapla giriş" gibi bir kaçış yolu — verilmezse gösterilmez */
  onCancel?: () => void
  submitLabel?: string
}

/** Doğrulama uygulamasındaki 6 haneli kodu isteyip oturumu aal2'ye yükseltir.
 *  Kullanıcının birden fazla doğrulayıcısı olabilir (ör. yedek telefon): kod
 *  hangisine aitse onunla eşleşene kadar sırayla denenir. */
export function MfaCodeForm({ onVerified, onCancel, submitLabel = 'Doğrula' }: Props) {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
    const totp = factors?.totp ?? []
    if (listError || totp.length === 0) {
      setError('Hesabınızda doğrulama uygulaması bulunamadı.')
      setLoading(false)
      return
    }

    for (const factor of totp) {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (!error) {
        await onVerified()
        return
      }
    }

    setError('Kod hatalı ya da süresi geçmiş. Uygulamadaki güncel kodu girin.')
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="Doğrulama Kodu"
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        hint="Doğrulama uygulamanızdaki (Google Authenticator, Authy vb.) 6 haneli kod"
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="submit" loading={loading} disabled={code.length !== 6} fullWidth className="mt-1">
        {submitLabel}
      </Button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Farklı bir hesapla giriş yap
        </button>
      )}
    </form>
  )
}
