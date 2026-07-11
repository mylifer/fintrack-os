import { supabase } from './supabase'
import type {
  Account, Transaction, Category, Budget, Debt,
  InvestmentTransaction, Person, RecurringTransaction,
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
