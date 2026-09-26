'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { db } from '@/lib/db'
import { isSyncTable, localRowOf, type SyncTable } from './engine'

/* ── Canlı senkron (Supabase Realtime) ─────────────────────────────────────────
   Başka bir cihazda yapılan değişiklik bu cihaza sayfa yenilenmeden gelsin
   diye `public` şemasındaki değişiklik olayları dinlenir (RLS geçerli: yalnız
   kullanıcının kendi satırları gelir). Tabloların `supabase_realtime`
   yayınına eklenmesi 0016'dadır; eklenmemişse hiç olay gelmez, uygulama eskisi
   gibi açılışta çeker.

   Olay satırın kendisini taşır ama doğrudan yerel veriye YAZILMAZ: ilgili
   tablonun store'u yeniden yüklenir (reconcilingPull) — bekleyen yerel
   yazmaları koruyan, silme/düzenleme çakışmasını çözen tek yol odur.

   Yankı: bu cihazın kendi push'u da olay üretir. Olaydaki updatedAt yerel
   satırınkiyle aynıysa (stampTime) değişiklik zaten buradadır → atlanır.
   Aynı tabloya art arda gelen olaylar tek yeniden yüklemede birleştirilir. */

const DEBOUNCE_MS = 1200

export function startRealtime(onTableChanged: (table: SyncTable) => void): () => void {
  const timers = new Map<SyncTable, ReturnType<typeof setTimeout>>()
  const schedule = (table: SyncTable) => {
    const prev = timers.get(table)
    if (prev) clearTimeout(prev)
    timers.set(table, setTimeout(() => { timers.delete(table); onTableChanged(table) }, DEBOUNCE_MS))
  }

  const channel: RealtimeChannel = supabase
    .channel('fintrack-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
      const table = payload.table
      if (!isSyncTable(table)) return
      const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
      const id = row?.id as string | undefined
      if (!id) { schedule(table); return }
      void (async () => {
        // Gönderilmemiş yerel yazma varsa onu flush çözer; yeniden yükleme gereksiz
        if (await db._outbox.get(`${table}:${id}`)) return
        const local = await localRowOf(table, id)
        const incoming = row.updatedAt as string | undefined
        if (local && incoming && local.updatedAt === incoming) return   // kendi yankımız
        schedule(table)
      })()
    })
    .subscribe()

  return () => {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    void supabase.removeChannel(channel)
  }
}
