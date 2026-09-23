import { supabase } from './supabase'
import { db } from './db'
import { isLive } from './sync/tombstone'
import { localBatch, type BatchOp } from './sync/engine'
import type {
  Account, Transaction, Category, Budget, Debt,
  InvestmentTransaction, Person, RecurringTransaction, PaymentSchedule,
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
  // Opsiyonel: bu alandan ÖNCEKİ yedeklerde yok. Anahtar yoksa geri yükleme
  // mevcut takvimlere DOKUNMAZ (boş dizi ise "hiç takvim yoktu" demektir).
  paymentSchedules?:      PaymentSchedule[]
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
 * Ödeme takvimlerini yedektekilerle değiştirir.
 *
 * restore_user_backup RPC'si bu tabloyu bilmiyor (0009 henüz üretimde test
 * edilmediği için ona dokunulmadı), bu yüzden değişim dayanıklı outbox
 * üzerinden yapılır: yedekte olmayan canlı takvimler tombstone'lanır, yedektekiler
 * upsert edilir. Tek Dexie transaction'ı (localBatch) — yerelde ya hepsi ya hiçbiri;
 * bulut tarafı outbox ile, çevrimdışıysa bağlantı gelince tamamlanır.
 * Çağıran: geri yükleme RPC'si COMMIT olduktan SONRA (writeDexie outbox'ı
 * temizlediği için bu girdiler ondan sonra eklenmeli).
 */
export async function replacePaymentSchedules(rows: PaymentSchedule[]): Promise<void> {
  const keep = new Set(rows.map(r => r.id))
  const current = (await db.paymentSchedules.toArray()).filter(isLive)
  const ts = new Date().toISOString()
  const ops: BatchOp[] = [
    ...current
      .filter(c => !keep.has(c.id))
      .map(c => ({ kind: 'patch' as const, table: 'payment_schedules' as const, id: c.id, patch: { deleted_at: ts } })),
    ...rows.map(r => ({ kind: 'upsert' as const, table: 'payment_schedules' as const, entity: r })),
  ]
  await localBatch(ops)
}
