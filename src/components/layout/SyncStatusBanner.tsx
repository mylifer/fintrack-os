'use client'

import { useEffect, useState } from 'react'
import { useSyncStatusStore } from '@/store/sync-status.store'
import { retryDeadLetters } from '@/lib/sync/engine'
import { repairStuckCategories, repairInvalidAccountRefs } from '@/lib/sync/repair'
import { reloadAllStores } from '@/lib/reload-stores'

/* ── Senkron sağlık bandı ────────────────────────────────────────────────
   Buluta yazılamayan kayıt varken kullanıcıyı SESSİZCE bırakmayız: dead-letter
   olmuş (deneme hakkı tükenmiş) kayıtlar kırmızı bantla ve son hata mesajıyla
   gösterilir, "Yeniden dene" sayaçları sıfırlayıp kuyruğu boşaltır. Normal
   senkron 1-2 sn sürdüğü için kısa süreli bekleyenler bant üretmez; kuyruk
   PENDING_GRACE_MS'den uzun kesintisiz doluysa sarı bilgi bandı çıkar. */

const PENDING_GRACE_MS = 8000

export function SyncStatusBanner() {
  const pending       = useSyncStatusStore(s => s.pending)
  const stuck         = useSyncStatusStore(s => s.stuck)
  const lastError     = useSyncStatusStore(s => s.lastError)
  const pendingSince  = useSyncStatusStore(s => s.pendingSince)
  const notice        = useSyncStatusStore(s => s.notice)
  const notify        = useSyncStatusStore(s => s.notify)
  const dismissNotice = useSyncStatusStore(s => s.dismissNotice)

  const [retrying, setRetrying]   = useState(false)
  const [repairing, setRepairing] = useState(false)

  // Kalıcı (deterministik) push hataları "Yeniden dene" ile çözülmez; onarım
  // butonu gösterilir (bkz. sync/repair.ts). retryDeadLetters her açılışta
  // sayaçları sıfırladığı için stuck sayısına DEĞİL, hata mesajına bakılır;
  // yoksa buton dakikalarca görünmez kalırdı.
  //   • row-level security → başka hesabın kimliğini taşıyan kategori satırı
  //   • invalid input syntax for type uuid → geçersiz hesap referanslı işlem
  const repairable = !!lastError && (
    lastError.includes('row-level security') ||
    lastError.includes('invalid input syntax for type uuid')
  )

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

  const isError = stuck > 0 || repairable
  const showStatus = isError || (overdue && pending > 0)
  if (!showStatus && !notice) return null

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

  async function handleRepair() {
    setRepairing(true)
    try {
      const cats = await repairStuckCategories()
      const accs = await repairInvalidAccountRefs()
      console.info('[sync:repair]', { ...cats, ...accs })
      await retryDeadLetters()

      // Sessiz veri hareketi yasağı: onarımın ne yaptığını kullanıcı görmeli.
      const parts: string[] = []
      const catTotal = cats.remapped + cats.rekeyed + cats.cleared
      if (catTotal)      parts.push(`${catTotal} kategori kaydı hesabına taşındı`)
      if (accs.fixed)    parts.push(`${accs.fixed} borç anaparası işlemi doğru hesaba bağlandı`)
      if (accs.redated)  parts.push(`${accs.redated} tanesinin tarihi bugüne çekildi (ileri tarihliyken bakiyeye girmiyordu)`)
      if (accs.dropped)  parts.push(`${accs.dropped} kullanılamaz satır yerelden kaldırıldı`)
      if (parts.length) notify(`Onarım: ${parts.join(', ')}.`)

      // Kategori onarımı KİMLİK değiştirir (remap/rekey) → bellekteki her şey
      // bayat, en güvenlisi tam yeniden yükleme. Yalnızca işlem satırı
      // onarıldıysa store'ları tazelemek yeterli; böylece yukarıdaki onarım
      // özeti de ekranda kalır.
      if (cats.remapped || cats.rekeyed) {
        window.location.reload()
      } else {
        await reloadAllStores()
        setRepairing(false)
      }
    } catch (err) {
      console.error('[sync:repair]', err)
      setRepairing(false)
    }
  }

  return (
    <div className="fixed bottom-24 lg:bottom-4 right-4 z-50 max-w-sm flex flex-col gap-2">
      {/* Bilgi bandı: motor kendi başına buluta kayıt geri yüklediğinde
          (requeue) görünür — sessiz veri hareketi yasağı. Kapatılabilir. */}
      {notice && (
        <div
          role="status"
          className="rounded-xl border px-4 py-3 shadow-lg text-xs bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold mb-0.5">Senkron bilgisi</div>
              <div className="opacity-80">{notice}</div>
            </div>
            <button
              type="button"
              onClick={dismissNotice}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-sky-500/20 transition-colors font-bold"
              aria-label="Kapat"
            >✕</button>
          </div>
        </div>
      )}

      {showStatus && (
    <div
      role="alert"
      className={[
        'rounded-xl border px-4 py-3 shadow-lg text-xs',
        isError
          ? 'bg-destructive/10 border-destructive/30 text-destructive'
          : 'bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400',
      ].join(' ')}
    >
      <div className="font-semibold mb-0.5">
        {isError
          ? `${stuck || pending} kayıt buluta senkronlanamıyor`
          : `${pending} kayıt senkron bekliyor…`}
      </div>
      <div className="text-muted-foreground">
        {isError
          ? 'Bu kayıtlar şimdilik yalnızca bu tarayıcıda duruyor; sorun giderilmeden çıkış yapmayın.'
          : 'Bağlantı gelince otomatik gönderilecek.'}
      </div>
      {/* Hata metnini BEKLEME (sarı) durumunda da göster: bir kayıt sessizce
          yeniden denenip duruyorsa dead-letter (kırmızı) olmadan da nedenini
          görebilmek gerek — teşhis için konsola girmeye gerek kalmaz. */}
      {lastError && (
        <div className="mt-1.5 font-mono text-[10px] leading-snug break-words opacity-80" title={lastError}>
          {lastError.length > 200 ? `${lastError.slice(0, 200)}…` : lastError}
        </div>
      )}
      {isError && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying || repairing}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-destructive text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {retrying ? 'Deneniyor…' : 'Yeniden dene'}
          </button>
          {repairable && (
            <button
              type="button"
              onClick={handleRepair}
              disabled={retrying || repairing}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
              title="Buluta gidemeyen kayıtları geçerli hale getirir: takılan kategoriler hesabına taşınır, geçersiz hesap referanslı işlemler doğru hesaba bağlanır. Veri silinmez."
            >
              {repairing ? 'Onarılıyor…' : 'Onar'}
            </button>
          )}
        </div>
      )}
    </div>
      )}
    </div>
  )
}
