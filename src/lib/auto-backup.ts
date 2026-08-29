import { supabase } from './supabase'
import { db } from './db'
import { getUserId } from './auth'
import { isLive } from './sync/tombstone'
import type { BackupData } from './backup-sync'

/**
 * Otomatik bulut yedekleri.
 *
 * Her snapshot, manuel JSON export dosyasıyla AYNI şekilde tutulur
 * ({ version, exportedAt, data }) — böylece bulut yedeği indirildiğinde
 * normal yedek dosyası olarak da geri yüklenebilir.
 *
 * Bu modül sync motorundan bilinçli olarak BAĞIMSIZDIR: yedekler senkronize
 * edilen varlıklar değildir, Dexie'de tablosu yoktur; doğrudan Supabase'e
 * yazılır. `user_backups` tablosu RLS ile owner-only'dir
 * (supabase/migrations/0005_user_backups.sql).
 *
 * Tüm fonksiyonlar best-effort'tur: tablo henüz oluşturulmamışsa veya ağ
 * yoksa hata fırlatır; çağıranlar (DataProvider, BackupManager) yakalar —
 * yedekleme hatası uygulamayı asla kırmaz.
 */

export type BackupKind = 'auto' | 'manual' | 'pre-restore'

export interface CloudBackupMeta {
  id: string
  created_at: string
  kind: BackupKind
  counts: Record<string, number>
}

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  auto: 'Otomatik',
  manual: 'Manuel',
  'pre-restore': 'Geri yükleme öncesi',
}

// Tür başına saklanan snapshot sayısı; fazlası en-eskiden budanır.
const KEEP: Record<BackupKind, number> = { auto: 14, manual: 10, 'pre-restore': 5 }

// Otomatik yedekler arasındaki asgari süre
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

/* Tüm Dexie tablolarının anlık kopyası (manuel export ile aynı kapsam).
 *
 * TOMBSTONE'LAR HARİÇ. Dexie yalnızca canlı satırları değil, silinmiş satırların
 * mezar taşlarını da tutar (silme, `deleted_at` taşıyan sıradan bir UPDATE olarak
 * yayılır — bkz. sync/tombstone.ts). Bunlar yedeğe girdiğinde geri yükleme RPC'si
 * yükteki HER satırı canlandırdığı için kullanıcının sildiği kayıtlar geri
 * DİRİLİYOR ve bakiyeler sessizce şişiyordu. (2026-08-29 güvenlik denetimi
 * sırasında bulundu: 785 satırlık gerçek bir yedekte 57 tombstone.)
 *
 * Silinmişlik yine de doğru şekilde korunur: RPC önce kullanıcının tüm
 * satırlarını tombstone'lar, sonra yalnızca YÜKTEKİLERİ canlandırır — yükte
 * olmayan satır tombstone kalır ve diğer cihazlar silmeyi pozitif kanıtla
 * öğrenmeye devam eder. Yani filtre, silmeyi kaybetmez; sadece dirilmeyi
 * engeller.
 *
 * Eski yedek dosyalarında tombstone'lar duruyor; RPC tarafında da ikinci bir
 * savunma var (0009: `deleted_at` artık yükten korunur, null'a zorlanmaz). */
export async function readSnapshot(): Promise<BackupData> {
  const [accounts, transactions, categories, budgets, debts, investmentTransactions, people, recurringTransactions] =
    await Promise.all([
      db.accounts.toArray(), db.transactions.toArray(), db.categories.toArray(),
      db.budgets.toArray(), db.debts.toArray(), db.investmentTransactions.toArray(),
      db.people.toArray(), db.recurringTransactions.toArray(),
    ])
  return {
    accounts:               accounts.filter(isLive),
    transactions:           transactions.filter(isLive),
    categories:             categories.filter(isLive),
    budgets:                budgets.filter(isLive),
    debts:                  debts.filter(isLive),
    investmentTransactions: investmentTransactions.filter(isLive),
    people:                 people.filter(isLive),
    recurringTransactions:  recurringTransactions.filter(isLive),
  }
}

function computeCounts(data: BackupData): Record<string, number> {
  return Object.fromEntries(Object.entries(data).map(([k, rows]) => [k, rows.length]))
}

export function totalRecords(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0)
}

/**
 * Yeni bir bulut snapshot'ı oluşturur ve o türün eski kopyalarını budar.
 * Oturum yoksa veya hiç veri yoksa sessizce null döner (yedeklenecek şey yok).
 */
export async function createCloudBackup(kind: BackupKind, snapshot?: BackupData): Promise<CloudBackupMeta | null> {
  const userId = await getUserId().catch(() => undefined)
  if (!userId) return null

  const data = snapshot ?? await readSnapshot()
  const counts = computeCounts(data)
  if (totalRecords(counts) === 0) return null // boş durumun yedeği anlamsız

  const payload = { version: 2, exportedAt: new Date().toISOString(), data }

  const { data: row, error } = await supabase
    .from('user_backups')
    .insert({ user_id: userId, kind, counts, payload })
    .select('id, created_at, kind, counts')
    .single()
  if (error) throw new Error(`Bulut yedeği oluşturulamadı: ${error.message}`)

  // Budama best-effort: başarısız olsa da snapshot alınmıştır.
  await pruneCloudBackups(userId, kind).catch(err => console.warn('[auto-backup:prune]', err))

  return row as CloudBackupMeta
}

/** Tür başına KEEP sınırını aşan en eski snapshot'ları siler. */
async function pruneCloudBackups(userId: string, kind: BackupKind): Promise<void> {
  const keep = KEEP[kind]
  const { data, error } = await supabase
    .from('user_backups')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .range(keep, keep + 49)
  if (error || !data?.length) return

  await supabase
    .from('user_backups')
    .delete()
    .eq('user_id', userId)
    .in('id', data.map(r => r.id))
}

/**
 * Uygulama açılışında çağrılır: son otomatik yedek 24 saatten eskiyse (veya hiç
 * yoksa) arka planda yeni bir tane alır. Veriler yüklendikten SONRA çağrılmalı.
 */
export async function maybeAutoBackup(): Promise<void> {
  const userId = await getUserId().catch(() => undefined)
  if (!userId) return

  const { data, error } = await supabase
    .from('user_backups')
    .select('created_at')
    .eq('user_id', userId)
    .eq('kind', 'auto')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    // Tablo henüz oluşturulmadıysa (migration çalıştırılmadı) sessizce çık.
    console.warn('[auto-backup] atlandı:', error.message)
    return
  }

  const last = data?.[0]?.created_at
  if (last && Date.now() - new Date(last).getTime() < AUTO_INTERVAL_MS) return

  await createCloudBackup('auto')
}

/** Kullanıcının snapshot listesi (payload'sız — liste ucuz kalsın). */
export async function listCloudBackups(): Promise<CloudBackupMeta[]> {
  const userId = await getUserId().catch(() => undefined)
  if (!userId) return []

  const { data, error } = await supabase
    .from('user_backups')
    .select('id, created_at, kind, counts')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(`Bulut yedekleri listelenemedi: ${error.message}`)
  return (data ?? []) as CloudBackupMeta[]
}

/** Tek snapshot'ın tam payload'ı (geri yükleme / indirme için). */
export async function fetchCloudBackupPayload(id: string): Promise<unknown> {
  const userId = await getUserId().catch(() => undefined)
  if (!userId) throw new Error('Oturum bulunamadı.')

  const { data, error } = await supabase
    .from('user_backups')
    .select('payload')
    .eq('user_id', userId)
    .eq('id', id)
    .single()
  if (error) throw new Error(`Bulut yedeği okunamadı: ${error.message}`)
  return data.payload
}
