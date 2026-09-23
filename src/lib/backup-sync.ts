import { supabase } from './supabase'
import { db } from './db'
import { isLive } from './sync/tombstone'
import { localBatch, type BatchOp } from './sync/engine'
import type {
  Account, Transaction, Category, Budget, Debt,
  InvestmentTransaction, Person, RecurringTransaction,
  PaymentPlan, PaymentOccurrence,
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

/**
 * Ödeme Takibi tablolarını (payment_plans, payment_occurrences) yedektekilerle
 * değiştirir.
 *
 * restore_user_backup RPC'si bu tabloları bilmiyor (0009 üretimde henüz test
 * edilmediği için ona dokunulmadı), bu yüzden değişim dayanıklı outbox üzerinden
 * yapılır: yedekte olmayan canlı kayıtlar tombstone'lanır, yedektekiler upsert
 * edilir. Tek Dexie transaction'ı (localBatch) — yerelde ya hepsi ya hiçbiri;
 * bulut tarafını outbox taşır, çevrimdışıysa bağlantı gelince tamamlanır.
 * Yedek bir tabloyu taşımıyorsa (eski yedek) o tablo olduğu gibi kalır.
 *
 * Çağıran: geri yükleme RPC'si COMMIT olduktan SONRA — writeDexie outbox'ı
 * temizlediği için bu girdiler ondan sonra eklenmeli.
 */
export async function replacePaymentTracking(data: BackupData): Promise<void> {
  const ts = new Date().toISOString()
  const ops: BatchOp[] = []
  const collect = (
    table: 'payment_plans' | 'payment_occurrences',
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
  await localBatch(ops)
}
