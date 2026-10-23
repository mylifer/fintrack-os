'use client'

import { db } from '@/lib/db'
import { localBatch, lastPullWasAuthoritative } from '@/lib/sync/engine'
import { reloadTable } from '@/lib/reload-stores'
import { useSyncStatusStore } from '@/store/sync-status.store'
import {
  findMislabeledInvestmentRows, planLedgerFixes, type PricePoint,
} from '@/lib/utils/investment-ledger-fix'
import type { CurrencyCode, Transaction } from '@/types'

/* Açılışta bir kez: döviz hesabına 'TRY' etiketiyle yazılmış ESKİ yatırım
   defter satırlarını işlem gününün kuruyla düzeltir (ayrıntı:
   lib/utils/investment-ledger-fix.ts). Bayrak yok — düzeltilen satır artık
   eşleşmediği için ikinci çalıştırma hiçbir şey bulmaz; kuru alınamayan satır
   bir sonraki açılışta yeniden denenir. TÜM çalışma alanları (Dexie) taranır,
   yalnız aktif olan değil. Sonuç kullanıcıya bildirilir; hiçbir şey yoksa sessiz. */

async function historyFor(currency: CurrencyCode, from: string): Promise<PricePoint[]> {
  try {
    const res = await fetch(`/api/prices/history?asset=${currency}&from=${from}`, { cache: 'no-store' })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return Array.isArray(data) ? (data as PricePoint[]) : []
  } catch {
    return []
  }
}

export async function fixForeignInvestmentLedger(): Promise<void> {
  // Yarım bir çekişte yerel veri eksik/bayat olabilir — o zaman dokunma
  if (!lastPullWasAuthoritative('transactions') || !lastPullWasAuthoritative('accounts')) return

  const [transactions, accounts] = await Promise.all([db.transactions.toArray(), db.accounts.toArray()])
  const rows = findMislabeledInvestmentRows(transactions as Transaction[], accounts)
  if (rows.length === 0) return

  // Para birimi başına tek seri isteği, en eski satırın gününden itibaren
  const currencyOf = new Map(accounts.map(a => [a.id, a.currency]))
  const earliest = new Map<CurrencyCode, string>()
  for (const t of rows) {
    const c = currencyOf.get(t.accountId)!
    const d = t.date.slice(0, 10)
    if (!earliest.has(c) || d < earliest.get(c)!) earliest.set(c, d)
  }
  const history: Partial<Record<CurrencyCode, PricePoint[]>> = {}
  await Promise.all([...earliest].map(async ([c, from]) => { history[c] = await historyFor(c, from) }))

  const fixes = planLedgerFixes(rows, accounts, history)
  if (fixes.length > 0) {
    await localBatch(fixes.map(f => ({ kind: 'patch' as const, table: 'transactions' as const, id: f.id, patch: f.patch })))
    await reloadTable('transactions')   // bellekteki liste + bakiyeler
  }

  const skipped = rows.length - fixes.length
  const notify = useSyncStatusStore.getState().notify
  if (fixes.length > 0 && skipped === 0) {
    notify(`Döviz hesabından yapılmış ${fixes.length} yatırım kaydı yanlış tutardaydı; işlem günündeki kurla düzeltildi ve hesap bakiyeleri güncellendi.`)
  } else if (fixes.length > 0) {
    notify(`Döviz hesabından yapılmış ${rows.length} yatırım kaydı yanlış tutardaydı; ${fixes.length} tanesi düzeltildi. Kalan ${skipped} kayıt için kur alınamadı, bir sonraki açılışta yeniden denenecek.`)
  } else {
    notify(`Döviz hesabından yapılmış ${rows.length} yatırım kaydı yanlış tutarda, ama kur bilgisi şu an alınamadı. Bir sonraki açılışta yeniden denenecek.`)
  }
}
