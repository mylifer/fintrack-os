'use client'

import { db } from '@/lib/db'
import { localBatch, MAX_SYNC_ATTEMPTS, type BatchOp } from './engine'
import { isLive } from './tombstone'
import type { Category, OutboxEntry } from '@/types'

/* ── Takılı kategori onarımı ────────────────────────────────────────────────
   Senaryo: yerel Dexie'de, bulutta BAŞKA bir kullanıcıya ait ID taşıyan
   kategori satırları kalmış (paylaşılan tarayıcıda eski/farklı bir oturumun
   kalıntısı). Push RLS'e takılır ("USING expression") ve kayıt sonsuza dek
   dead-letter kalır — "Yeniden dene" çözmez, hata deterministiktir.

   Onarım stratejisi (veri kaybı YOK):
   • Aynı isim+scope'ta canlı bir kategori varsa → referanslar ona taşınır
     (remap), yabancı satır yalnızca YERELDEN silinir.
   • Yoksa → kategori YENİ bir kimlikle kullanıcının hesabına kopyalanır
     (rekey), referanslar yeni kimliğe taşınır, eski satır yerelden silinir.
   Yabancı satır asla tombstone'lanmaz: buluta o ID ile hiçbir şey yazamayız. */

export interface RepairResult {
  remapped: number   // mevcut aynı isimli kategoriye bağlandı
  rekeyed: number    // yeni kimlikle kullanıcı hesabına kopyalandı
  cleared: number    // satır zaten yok/silinmişti; yalnızca kuyruk temizlendi
}

const norm = (s: string) => s.trim().toLocaleLowerCase('tr-TR')

function isRlsStuck(e: OutboxEntry): boolean {
  return (
    e.table === 'categories' &&
    e.attempts >= MAX_SYNC_ATTEMPTS &&
    (e.lastError ?? '').includes('row-level security')
  )
}

export async function repairStuckCategories(): Promise<RepairResult> {
  const result: RepairResult = { remapped: 0, rekeyed: 0, cleared: 0 }

  const stuck = (await db._outbox.toArray()).filter(isRlsStuck)
  if (stuck.length === 0) return result

  const stuckIds = new Set(stuck.map(e => e.entityId))
  const allCats  = (await db.categories.toArray()) as Category[]
  const byId     = new Map(allCats.map(c => [c.id, c]))
  // Hedef adaylar: takılı olmayan, canlı kategoriler
  const targets  = allCats.filter(c => isLive(c) && !stuckIds.has(c.id))

  // 1. geçiş: her takılı ID için yeni kimliği kararlaştır (remap veya rekey).
  // Referans taşıma ve klon oluşturma 2. geçişte yapılır ki takılı bir alt
  // kategorinin parentId'si de haritadan doğru yeni kimliğe çevrilebilsin.
  const idMap  = new Map<string, string>()
  const toClone: Category[] = []

  for (const e of stuck) {
    const row = byId.get(e.entityId)
    if (!row || !isLive(row)) continue // satır yok ya da zaten silinmiş — aşağıda yalnızca temizlenir

    const target = targets.find(c => norm(c.name) === norm(row.name) && c.scope === row.scope)
    if (target) {
      idMap.set(row.id, target.id)
      result.remapped++
    } else {
      const newId = crypto.randomUUID()
      idMap.set(row.id, newId)
      toClone.push(row)
      result.rekeyed++
    }
  }

  // 2. geçiş: klonlar + referans taşıma tek atomik batch'te.
  const ops: BatchOp[] = []

  for (const row of toClone) {
    const clone: Category = { ...row, id: idMap.get(row.id)! }
    if (clone.parentId && idMap.has(clone.parentId)) clone.parentId = idMap.get(clone.parentId)
    ops.push({ kind: 'upsert', table: 'categories', entity: clone })
  }

  for (const [oldId, newId] of idMap) {
    const txIds = (await db.transactions.filter(t => t.categoryId === oldId).toArray()).map(t => t.id)
    const bdIds = (await db.budgets.filter(b => b.categoryId === oldId).toArray()).map(b => b.id)
    const rcIds = (await db.recurringTransactions.filter(r => r.categoryId === oldId).toArray()).map(r => r.id)
    const chIds = (await db.categories.filter(c => c.parentId === oldId && !stuckIds.has(c.id)).toArray()).map(c => c.id)

    if (txIds.length) ops.push({ kind: 'patchMany', table: 'transactions',            ids: txIds, patch: { categoryId: newId } })
    if (bdIds.length) ops.push({ kind: 'patchMany', table: 'budgets',                 ids: bdIds, patch: { categoryId: newId } })
    if (rcIds.length) ops.push({ kind: 'patchMany', table: 'recurring_transactions',  ids: rcIds, patch: { categoryId: newId } })
    if (chIds.length) ops.push({ kind: 'patchMany', table: 'categories',              ids: chIds, patch: { parentId: newId } })
  }

  await localBatch(ops)

  // 3. geçiş: yabancı satırları YERELDEN kaldır + kuyruk girdilerini sil.
  // (localBatch başarıyla commit olduktan sonra — yarıda kesilirse onarım
  // tekrar çalıştırılabilir: klonlar artık aynı isimli canlı hedef olduğundan
  // ikinci koşu remap yoluna düşer ve yinelenen kopya oluşmaz.)
  for (const e of stuck) {
    await db.categories.delete(e.entityId)
    await db._outbox.delete(e.id)
    if (!idMap.has(e.entityId)) result.cleared++
  }

  return result
}
