import { supabase } from '@/lib/supabase'
import type { Receipt } from '@/types'

/* ── Fiş / fatura eki (Supabase Storage, migration 0019) ────────────────────
   Dosya ÖZEL "receipts" kovasına <user_id>/<tx_id>-<rastgele>.<uzantı> yoluyla
   yüklenir; işlem satırında yalnız { path, name, type, size } durur. Açmak için
   kısa ömürlü (2 dk) imzalı bağlantı üretilir — kalıcı, paylaşılabilir URL yok.

   Çevrimdışı çalışmaz: yükleme/açma bağlantı ister (işlemin kendisi yine
   Dexie'de çevrimdışı düzenlenebilir). Büyük fotoğraflar yüklemeden önce
   1600 px'e küçültülür (telefon fotoğrafı 4–8 MB → ~300 KB). */

export const RECEIPT_BUCKET    = 'receipts'
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024
export const RECEIPT_ACCEPT    = 'image/jpeg,image/png,image/webp,application/pdf'
const MAX_DIM          = 1600
const SHRINK_OVER      = 1_000_000   // bu boyutun altındaki, zaten küçük görsel olduğu gibi gider
const SIGNED_URL_TTL_S = 120

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
}

/** Yükleme öncesi doğrulama; sorun yoksa null. (Görsel sınırı küçültme SONRASI boyuta uygulanır.) */
export function receiptFileError(file: { type: string; size: number }): string | null {
  if (!EXT[file.type]) return 'Yalnız JPEG, PNG, WebP ya da PDF eklenebilir.'
  if (file.type === 'application/pdf' && file.size > RECEIPT_MAX_BYTES) return 'PDF en çok 5 MB olabilir.'
  return null
}

/** En uzun kenar `max`'ı aşmayacak şekilde oranı koruyarak boyut. */
export function fitWithin(w: number, h: number, max = MAX_DIM): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

export function receiptPath(userId: string, txId: string, type: string, rand: string): string {
  return `${userId}/${txId}-${rand}.${EXT[type] ?? 'bin'}`
}

/** Büyük görseli JPEG'e küçültür; PDF ve küçük görsel olduğu gibi döner. */
async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const bmp = await createImageBitmap(file)
  const { width, height } = fitWithin(bmp.width, bmp.height)
  if (width === bmp.width && file.size <= SHRINK_OVER) { bmp.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Görsel işlenemedi'))), 'image/jpeg', 0.82))
}

function friendly(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err)
  if (/bucket not found/i.test(msg)) return new Error('Sunucu tarafı hazır değil (0019 migration uygulanmamış).')
  if (/row-level security|unauthori[sz]ed|jwt|not authenticated/i.test(msg)) return new Error('Oturum doğrulanamadı — tekrar giriş yapıp deneyin.')
  if (/exceeded|too large|payload/i.test(msg)) return new Error('Dosya çok büyük (en çok 5 MB).')
  if (/failed to fetch|network/i.test(msg)) return new Error('Bağlantı yok — fiş eklemek için internet gerekli.')
  return new Error('Fiş yüklenemedi, tekrar deneyin.')
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Oturum doğrulanamadı — tekrar giriş yapıp deneyin.')
  return id
}

/** Dosyayı yükler ve işleme yazılacak Receipt'i döner. */
export async function uploadReceipt(txId: string, file: File): Promise<Receipt> {
  const invalid = receiptFileError(file)
  if (invalid) throw new Error(invalid)
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Bağlantı yok — fiş eklemek için internet gerekli.')

  const userId = await currentUserId()
  const blob = await shrinkImage(file)
  if (blob.size > RECEIPT_MAX_BYTES) throw new Error('Dosya çok büyük (en çok 5 MB).')
  const type = blob.type || file.type
  const path = receiptPath(userId, txId, type, crypto.randomUUID().slice(0, 8))

  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: type, upsert: false })
  if (error) throw friendly(error)
  return { path, name: file.name.slice(0, 120), type, size: blob.size }
}

/** Kısa ömürlü imzalı bağlantı (yeni sekmede açmak için). */
export async function receiptUrl(receipt: Receipt): Promise<string> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(receipt.path, SIGNED_URL_TTL_S)
  if (error || !data?.signedUrl) throw friendly(error ?? new Error('url'))
  return data.signedUrl
}

export async function deleteReceiptFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path])
  if (error) throw friendly(error)
}

/** Hesap silinirken: kullanıcının tüm fiş dosyaları (delete_my_account SQL'den
 *  Storage'ı silemez). Kova yoksa (0019 uygulanmamış) sessizce geçer. */
export async function removeAllReceipts(): Promise<void> {
  const userId = await currentUserId()
  const bucket = supabase.storage.from(RECEIPT_BUCKET)
  for (;;) {
    const { data, error } = await bucket.list(userId, { limit: 100 })
    if (error) {
      if (/bucket not found/i.test(error.message)) return
      throw friendly(error)
    }
    if (!data?.length) return
    const { error: rmErr } = await bucket.remove(data.map(o => `${userId}/${o.name}`))
    if (rmErr) throw friendly(rmErr)
    if (data.length < 100) return
  }
}
