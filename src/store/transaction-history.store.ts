'use client'

import { db } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { getUserId } from '@/lib/auth'
import { isLive } from '@/lib/sync/tombstone'
import type { TransactionHistoryEntry } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   İşlem değişiklik geçmişi — OKUMA yolu (talep üzerine)

   Bilerek bir Zustand store DEĞİL: geçmiş açılışta topluca BELLEĞE
   YÜKLENMEZ. Satır sayısı her düzenlemeyle artar ve zamanla sınırsız büyür;
   diğer tablolar gibi reconcilingPull ile çekilse açılış süresi ve bellek
   kullanımı kaydın yaşıyla birlikte şişerdi. Bunun yerine kullanıcı bir
   kaydın geçmişini AÇTIĞINDA yalnız o kaydın satırları okunur.

   Yazma yolu bambaşka yerde: sync engine'in yerel yazma primitive'leri
   (src/lib/sync/engine.ts → recordHistory, diff: src/lib/sync/history.ts).
──────────────────────────────────────────────────────────────────────── */

/** Bir işlemin geçmişi — `at` AZALAN sırada (en yenisi başta).
 *
 *  1. Dexie'den o `txId`nin satırları okunur (çevrimdışı da çalışır).
 *  2. Girişliyse bulut da sorgulanır (`transaction_history`, txId eşitliği —
 *     RLS kullanıcıyı/paylaşılan alanı zaten kapsar) ve gelen satırlar
 *     Dexie'ye yazılır; böylece başka cihazda yapılan düzenlemeler de görünür.
 *  3. Bulut hatası / çevrimdışı / tablo henüz yok (0029 uygulanmamış) →
 *     SESSİZCE yalnız yerel satırlarla devam edilir. Geçmiş paneli bir
 *     yardımcı ekrandır; hata kullanıcının önüne çıkmaz. */
export async function loadTxHistory(txId: string): Promise<TransactionHistoryEntry[]> {
  const byId = new Map<string, TransactionHistoryEntry>()
  for (const row of await db.transactionHistory.where('txId').equals(txId).toArray()) {
    byId.set(row.id, row)
  }

  try {
    const userId = await getUserId()
    if (userId) {
      const { data, error } = await supabase
        .from('transaction_history')
        .select('*')
        .eq('txId', txId)
      if (error) throw error
      const cloud = (data ?? []) as TransactionHistoryEntry[]
      if (cloud.length) {
        await db.transactionHistory.bulkPut(cloud)
        for (const row of cloud) byId.set(row.id, row)
      }
    }
  } catch (err) {
    console.error('[transaction-history:load]', err)
  }

  return [...byId.values()]
    .filter(isLive)
    .sort((a, b) => b.at.localeCompare(a.at))
}
