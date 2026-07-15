'use client'

import { useEffect, useState } from 'react'
import { useSyncStatusStore } from '@/store/sync-status.store'
import { retryDeadLetters } from '@/lib/sync/engine'

/* ── Senkron sağlık bandı ────────────────────────────────────────────────
   Buluta yazılamayan kayıt varken kullanıcıyı SESSİZCE bırakmayız: dead-letter
   olmuş (deneme hakkı tükenmiş) kayıtlar kırmızı bantla ve son hata mesajıyla
   gösterilir, "Yeniden dene" sayaçları sıfırlayıp kuyruğu boşaltır. Normal
   senkron 1-2 sn sürdüğü için kısa süreli bekleyenler bant üretmez; kuyruk
   PENDING_GRACE_MS'den uzun kesintisiz doluysa sarı bilgi bandı çıkar. */

const PENDING_GRACE_MS = 8000

export function SyncStatusBanner() {
  const pending      = useSyncStatusStore(s => s.pending)
  const stuck        = useSyncStatusStore(s => s.stuck)
  const lastError    = useSyncStatusStore(s => s.lastError)
  const pendingSince = useSyncStatusStore(s => s.pendingSince)

  const [retrying, setRetrying] = useState(false)

  // Kuyruk dolu→boş/boş→dolu geçişinde overdue'yu render sırasında sıfırla
  // (resmî "derive state during render" kalıbı); eşik aşımını efekt yalnızca
  // zamanlayıcı callback'inde işaretler — render ve efekt gövdesi saf kalır.
  const [overdue, setOverdue] = useState(false)
  const [seenSince, setSeenSince] = useState(pendingSince)
  if (seenSince !== pendingSince) {
    setSeenSince(pendingSince)
    setOverdue(false)
  }

  useEffect(() => {
    if (pendingSince === null) return
    const t = setTimeout(() => setOverdue(true), PENDING_GRACE_MS)
    return () => clearTimeout(t)
  }, [pendingSince])

  const isError = stuck > 0
  if (!isError && !(overdue && pending > 0)) return null

  async function handleRetry() {
    setRetrying(true)
    try {
      await retryDeadLetters()
    } catch (err) {
      console.error('[sync:retry]', err)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="alert"
      className={[
        'fixed bottom-24 lg:bottom-4 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg text-xs',
        isError
          ? 'bg-destructive/10 border-destructive/30 text-destructive'
          : 'bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400',
      ].join(' ')}
    >
      <div className="font-semibold mb-0.5">
        {isError
          ? `${stuck} kayıt buluta senkronlanamıyor`
          : `${pending} kayıt senkron bekliyor…`}
      </div>
      <div className="text-muted-foreground">
        {isError
          ? 'Bu kayıtlar şimdilik yalnızca bu tarayıcıda duruyor; sorun giderilmeden çıkış yapmayın.'
          : 'Bağlantı gelince otomatik gönderilecek.'}
      </div>
      {isError && lastError && (
        <div className="mt-1.5 font-mono text-[10px] leading-snug break-words opacity-80" title={lastError}>
          {lastError.length > 160 ? `${lastError.slice(0, 160)}…` : lastError}
        </div>
      )}
      {isError && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="mt-2 px-2.5 py-1 rounded-lg text-xs font-semibold bg-destructive text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {retrying ? 'Deneniyor…' : 'Yeniden dene'}
        </button>
      )}
    </div>
  )
}
