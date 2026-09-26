'use client'

import { useRef, useState } from 'react'
import { useTransactionStore } from '@/store'
import { deleteReceiptFile, receiptUrl, uploadReceipt, RECEIPT_ACCEPT } from '@/lib/receipts'
import type { Transaction } from '@/types'

/* Kayıtlı bir işlemin fiş / fatura eki (lib/receipts). Formun Kaydet akışından
   BAĞIMSIZ çalışır: seçilen dosya hemen yüklenir ve işleme yazılır; Kaydet'e
   basmadan kapatmak eki geri almaz. Yeni işlemde görünmez — dosya yolu işlem
   kimliğine bağlı, işlem önce kaydedilmeli. */

const btn = 'px-2.5 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50'

function kb(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

export function ReceiptField({ tx }: { tx: Transaction }) {
  const updateTx = useTransactionStore(s => s.update)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]   = useState<'upload' | 'open' | 'remove' | null>(null)
  const [error, setError] = useState('')
  const receipt = tx.receipt ?? null

  async function onFile(file: File | undefined) {
    if (!file || busy) return
    setBusy('upload'); setError('')
    try {
      const next = await uploadReceipt(tx.id, file)
      await updateTx(tx.id, { receipt: next })
      // Eski dosya yeni ek işlemin üzerine yazıldıktan SONRA silinir; silinemezse
      // yalnız sahipsiz bir dosya kalır, işlem doğru eki gösterir.
      if (receipt) await deleteReceiptFile(receipt.path).catch(err => console.error('[receipt:old]', err))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fiş yüklenemedi.')
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function open() {
    if (!receipt || busy) return
    setBusy('open'); setError('')
    // Açılır pencere engelleyicisi: sekme tıklama ANINDA açılır, adres sonra verilir
    const win = window.open('', '_blank')
    try {
      const url = await receiptUrl(receipt)
      if (win) { win.opener = null; win.location.href = url }
      else window.location.href = url
    } catch (err) {
      win?.close()
      setError(err instanceof Error ? err.message : 'Fiş açılamadı.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!receipt || busy) return
    setBusy('remove'); setError('')
    try {
      await updateTx(tx.id, { receipt: null })
      await deleteReceiptFile(receipt.path).catch(err => console.error('[receipt:remove]', err))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fiş kaldırılamadı.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="hidden"
        aria-label="Fiş ya da fatura dosyası seç"
        onChange={e => onFile(e.target.files?.[0])}
      />
      {receipt ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
          <span aria-hidden>📎</span>
          <span className="text-sm truncate min-w-0 flex-1" title={receipt.name}>
            {receipt.name} <span className="text-xs text-muted-foreground">· {kb(receipt.size)}</span>
          </span>
          <button type="button" className={btn} disabled={!!busy} onClick={open}>
            {busy === 'open' ? 'Açılıyor…' : 'Görüntüle'}
          </button>
          <button type="button" className={btn} disabled={!!busy} onClick={() => inputRef.current?.click()}>
            {busy === 'upload' ? 'Yükleniyor…' : 'Değiştir'}
          </button>
          <button type="button" className={`${btn} hover:text-destructive`} disabled={!!busy} onClick={remove}>
            {busy === 'remove' ? 'Kaldırılıyor…' : 'Kaldır'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} disabled={!!busy} onClick={() => inputRef.current?.click()}>
            {busy === 'upload' ? 'Yükleniyor…' : '📎 Fiş / fatura ekle'}
          </button>
          <span className="text-xs text-muted-foreground">JPEG, PNG, WebP ya da PDF · büyük fotoğraf küçültülür</span>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
