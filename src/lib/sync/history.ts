import type { TransactionHistoryEntry, TxHistoryAction, TxHistorySource } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   İşlem değişiklik geçmişi — SAF diff mantığı

   Bu modül bilerek Dexie/Supabase/React'ten bağımsızdır: engine'in yerel
   yazma primitive'leri (localUpsert / localBulkUpsert / localPatch /
   localPatchMany / localBatch) Dexie işleminin İÇİNDE buradaki saf
   fonksiyonları çağırır ve dönen satırı yazar. Mantık burada olduğu için
   kolay test edilir (history.test.ts) ve en riskli dosya olan engine.ts
   mümkün olduğunca sade kalır.

   Değer-eşitliği: alanlar JSON serileştirmesiyle karşılaştırılır (dizi/nesne
   dahil). `undefined` ile `null` AYNI sayılır — yoksa Dexie'de anahtarın hiç
   olmaması ile açık null arasındaki fark her yazmada gürültü satırı üretirdi.
──────────────────────────────────────────────────────────────────────── */

/** Geçmişe GİRMEYEN alanlar. `updatedAt` her yazmada değişir (anlamı zaten
 *  satırın kendi `at` damgası), `user_id` çalışma zamanı alanıdır ve asla
 *  kullanıcı düzenlemesi değildir. */
const IGNORED = new Set(['updatedAt', 'user_id'])

/** Tek bir değerin JSON gösteriminin azami uzunluğu. Uzun not / kategori payı
 *  / fiş nesnesi geçmiş satırını şişirmesin diye kırpılır. */
export const MAX_VALUE_CHARS = 500

const isBlank = (v: unknown): boolean => v === undefined || v === null

/** Karşılaştırma için kararlı bir metin gösterimi. undefined ↔ null aynı. */
function canonical(v: unknown): string {
  if (isBlank(v)) return 'null'
  try {
    return JSON.stringify(v) ?? 'null'
  } catch {
    return String(v)
  }
}

/** JSON-güvenli, boyutu sınırlı bir değer. Kırpılan değer metne çevrilir ve
 *  sonuna '…' eklenir (arayüz onu olduğu gibi gösterir). */
export function safeValue(v: unknown): unknown {
  if (v === undefined) return null
  const text = canonical(v)
  if (text.length <= MAX_VALUE_CHARS) {
    // Serileştirilemeyen değer (fonksiyon, döngüsel nesne) metin olarak geçer.
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }
  return `${(typeof v === 'string' ? v : text).slice(0, MAX_VALUE_CHARS)}…`
}

/** İki satırın BİRLEŞİK anahtar kümesinde dolaşır; değişen alanlar için
 *  `{ alan: [eski, yeni] }` döner. Değişmeyen alan GİRMEZ. */
export function diffRow(
  prev: Record<string, unknown> | undefined | null,
  next: Record<string, unknown> | undefined | null,
): Record<string, [unknown, unknown]> {
  const a = prev ?? {}
  const b = next ?? {}
  const out: Record<string, [unknown, unknown]> = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORED.has(key)) continue
    if (canonical(a[key]) === canonical(b[key])) continue
    out[key] = [safeValue(a[key]), safeValue(b[key])]
  }
  return out
}

const tombstoned = (row: Record<string, unknown> | undefined | null): boolean =>
  !!row && !isBlank(row.deleted_at)

/** prev yok → 'create'; canlı→tombstone → 'delete'; tombstone→canlı →
 *  'restore'; aksi hâlde 'update'. */
export function actionOf(
  prev: Record<string, unknown> | undefined | null,
  next: Record<string, unknown> | undefined | null,
): TxHistoryAction {
  if (!prev) return 'create'
  if (!tombstoned(prev) && tombstoned(next)) return 'delete'
  if (tombstoned(prev) && !tombstoned(next)) return 'restore'
  return 'update'
}

/** Kısa, kişisel veri taşımayan cihaz etiketi ("Chrome · macOS"). Tam
 *  user-agent BİLEREK yazılmaz (parmak izi / kişisel veri). Sunucu tarafında
 *  (SSR, test) undefined döner. */
export function deviceLabel(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  const ua = navigator.userAgent
  if (!ua) return undefined
  const browser =
    /Edg\//.test(ua)                      ? 'Edge'
    : /OPR\//.test(ua)                    ? 'Opera'
    : /Firefox\//.test(ua)                ? 'Firefox'
    : /Chrome\//.test(ua)                 ? 'Chrome'
    : /Safari\//.test(ua)                 ? 'Safari'
    : undefined
  const os =
    /iPhone|iPad|iPod/.test(ua)           ? 'iOS'
    : /Android/.test(ua)                  ? 'Android'
    : /Mac OS X|Macintosh/.test(ua)       ? 'macOS'
    : /Windows/.test(ua)                  ? 'Windows'
    : /Linux/.test(ua)                    ? 'Linux'
    : undefined
  const label = [browser, os].filter(Boolean).join(' · ')
  return label || undefined
}

export interface HistoryMeta {
  source?: TxHistorySource
  device?: string | null
  workspaceId?: string | null
}

/** Bir işlem yazmasından geçmiş satırı üretir.
 *  Diff BOŞSA null döner (gürültü satırı yazılmaz) — TEK istisna 'create':
 *  kaydın doğduğu an diff boş olsa bile geçmişe girer. */
export function historyRowFor(
  txId: string,
  prev: Record<string, unknown> | undefined | null,
  next: Record<string, unknown> | undefined | null,
  meta: HistoryMeta | undefined,
  at: string,
  newId: string,
): TransactionHistoryEntry | null {
  const action = actionOf(prev, next)
  const changes = diffRow(prev, next)
  if (action !== 'create' && Object.keys(changes).length === 0) return null
  return {
    id:          newId,
    txId,
    at,
    action,
    source:      meta?.source ?? 'app',
    changes,
    device:      meta?.device ?? null,
    createdAt:   at,
    updatedAt:   at,
    workspaceId: meta?.workspaceId ?? (next?.workspaceId as string | null | undefined) ?? null,
    deleted_at:  null,
  }
}
