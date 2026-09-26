import { supabase } from './supabase'
import { db } from './db'
import { isLive } from './sync/tombstone'
import { localBatch, type BatchOp } from './sync/engine'
import type {
  Account, Transaction, Category, Budget, Debt,
  InvestmentTransaction, Person, RecurringTransaction,
  PaymentPlan, PaymentOccurrence, SavingsGoal,
} from '@/types'

/**
 * Cloud replace for backup restore.
 *
 * The stores are cloud-authoritative: every load() clears Dexie and repopulates
 * it from Supabase. A restore that writes only Dexie is therefore wiped by the
 * next load(). This pushes the restored data to Supabase before any load() runs.
 *
 * The whole cloud replace runs server-side in ONE transaction via the
 * `restore_user_backup` RPC (see supabase/migrations/0001_restore_user_backup.sql),
 * so there is no partial-sync window if the network drops mid-way — it either
 * fully succeeds or fully rolls back. No offline queue / outbox.
 */

export interface BackupData {
  accounts:               Account[]
  transactions:           Transaction[]
  categories:             Category[]
  budgets:                Budget[]
  debts:                  Debt[]
  investmentTransactions: InvestmentTransaction[]
  people:                 Person[]
  recurringTransactions:  RecurringTransaction[]
  // Ödeme Takibi — opsiyonel: bu alanlardan ÖNCEKİ yedeklerde yok. Anahtar
  // yoksa geri yükleme o tabloya DOKUNMAZ (boş dizi ise "hiç kayıt yoktu" demektir).
  paymentPlans?:          PaymentPlan[]
  paymentOccurrences?:    PaymentOccurrence[]
  // Birikim Hedefleri — aynı kural: anahtar yoksa (eski yedek) dokunulmaz.
  savingsGoals?:          SavingsGoal[]
}

/**
 * Atomically replace ALL of the user's rows in Supabase with the backup data.
 * Throws if the RPC reports an error so the caller can roll back local state.
 */
export async function cloudReplaceAll(data: BackupData, userId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_user_backup', {
    payload: data as unknown as Record<string, unknown>,
    target_user_id: userId,
  })
  if (error) throw new Error(`Bulut geri yükleme hatası: ${error.message}`)
}

/** RPC'nin kapsamı DIŞINDA kalan, geri yüklemede outbox üzerinden değiştirilen
 *  tablolar. BackupManager.writeDexie bunların bekleyen outbox girdilerini
 *  silmez — bkz. replaceOutboxTables. */
export const OUTBOX_RESTORED_TABLES = ['payment_plans', 'payment_occurrences', 'savings_goals'] as const
type OutboxRestoredTable = typeof OUTBOX_RESTORED_TABLES[number]

/**
 * RPC'nin bilmediği tabloları — Ödeme Takibi (payment_plans,
 * payment_occurrences) ve Birikim Hedefleri (savings_goals) — yedektekilerle
 * değiştirir.
 *
 * restore_user_backup RPC'si bu tabloları bilmiyor (0009'un tablo listesi sabit;
 * üretimde çalışan fonksiyona dokunmamak için genişletilmedi), bu yüzden değişim
 * dayanıklı outbox üzerinden yapılır: yedekte olmayan canlı kayıtlar
 * tombstone'lanır, yedektekiler upsert edilir. Tek Dexie transaction'ı
 * (localBatch) — yerelde ya hepsi ya hiçbiri; bulut tarafını outbox taşır,
 * çevrimdışıysa bağlantı gelince tamamlanır. Yedek bir tabloyu taşımıyorsa
 * (eski yedek) o tablo olduğu gibi kalır.
 *
 * Çağıran: geri yükleme RPC'si COMMIT olduktan SONRA — writeDexie outbox'ı
 * temizlediği için bu girdiler ondan sonra eklenmeli.
 */
export async function replaceOutboxTables(data: BackupData): Promise<void> {
  const ts = new Date().toISOString()
  const ops: BatchOp[] = []
  const collect = (
    table: OutboxRestoredTable,
    current: { id: string; deleted_at?: string | null }[],
    rows: { id: string }[] | undefined,
  ) => {
    if (!rows) return
    const keep = new Set(rows.map(r => r.id))
    for (const c of current.filter(isLive)) {
      if (!keep.has(c.id)) ops.push({ kind: 'patch', table, id: c.id, patch: { deleted_at: ts } })
    }
    for (const r of rows) ops.push({ kind: 'upsert', table, entity: r })
  }
  if (data.paymentPlans) collect('payment_plans', await db.paymentPlans.toArray(), data.paymentPlans)
  if (data.paymentOccurrences) collect('payment_occurrences', await db.paymentOccurrences.toArray(), data.paymentOccurrences)
  if (data.savingsGoals) collect('savings_goals', await db.savingsGoals.toArray(), data.savingsGoals)
  await localBatch(ops)
}

/* ── Dış ikon adresleri (güvenlik denetimi F6) ────────────────────────────────
   Hesap ikonu bir URL olabilir ve AccountAvatar onu doğrudan yükler. Kötü
   niyetli bir yedek dosyası ("verini taşıdım, bunu içe aktar") ikon alanına
   izleme pikseli koyup kullanıcının her açılışta dış bir sunucuya istek
   atmasını sağlayabilir. Geri yüklemede bu adresler varsayılan olarak
   ayıklanır; kullanıcı dosyayı kendisi oluşturduysa korumayı seçebilir.
   Cihazda gömülü (data:) ikonlar dokunulmadan kalır. */

const isExternalUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v.trim())

/** Yedekteki dış adresli hesap ikonlarının alan adları (tekil). */
export function externalIconHosts(data: Pick<BackupData, 'accounts'>): string[] {
  const hosts = new Set<string>()
  for (const a of data.accounts ?? []) {
    if (!isExternalUrl(a.icon)) continue
    try { hosts.add(new URL(a.icon.trim()).hostname) } catch { hosts.add(a.icon.trim().slice(0, 60)) }
  }
  return [...hosts]
}

/** Dış adresli hesap ikonları kaldırılmış kopya. */
export function stripExternalIcons<T extends Pick<BackupData, 'accounts'>>(data: T): T {
  return {
    ...data,
    accounts: (data.accounts ?? []).map(a => (isExternalUrl(a.icon) ? { ...a, icon: undefined } : a)),
  }
}
