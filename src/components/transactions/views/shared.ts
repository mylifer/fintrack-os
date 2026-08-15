import { computeTransactionEffect } from '@/lib/utils/calculations'
import { today } from '@/lib/utils/date'
import type { Account, PersonRole, Transaction } from '@/types'
import type { TxSortOption } from '../TransactionList'

/* Hesap detayındaki işlem listesinin dört görünümü arasında paylaşılan sözleşme
   ve hesaplamalar. Görünümler yalnızca SUNUM katmanıdır: filtreleme, dönem,
   planlanan işlem üretimi ve seçim state'i sayfada (AccountDetailClient) kalır. */

export interface TxSelectionProps {
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onSelectMany?: (ids: string[], selected: boolean) => void
}

export interface TxViewProps extends TxSelectionProps {
  /** Gösterilecek işlemler — gerçekleşenler + planlananlar birlikte. */
  transactions: Transaction[]
  /** Detayı açık olan hesap; bakiye/net hesapları bu hesabın gözünden yapılır. */
  account: Account
  /** Planlanan (tekrarlayan şablondan projekte edilmiş) işlem id'leri. */
  projectedIds: Set<string>
  /** Planlanan işlemlerin kendisi — ileriye dönük bakiye projeksiyonu için. */
  plannedTxs: Transaction[]
  sort: TxSortOption
  emptyTitle: string
  emptyDescription: string
  onPersonClick?: (role: PersonRole, id: string) => void
  /** Kaydırma kabının yükseklik sınıfı. Sayfa kolonu sınırsız yükseklikte
   *  (layout `min-h-screen`) olduğu için `h-full` çöker — yükseklik viewport'a
   *  göre verilir ve görünüm çubuğunun payı kabuktan gelir. */
  heightClass: string
}

/** Gün sınırı: legacy tam-ISO datetime tarihler (`2026-08-15T15:00`) de doğru
 *  kıyaslansın diye her yerde `slice(0, 10)` ile karşılaştırılır. */
export function isFutureDate(date: string, todayStr: string = today()): boolean {
  return date.slice(0, 10) > todayStr
}

/** Listeyi "gelecek" (bugünden sonrası) ve "gerçekleşen" olarak ikiye ayırır —
 *  dört görünüm de bu ayrımı aynı şekilde gösterir. */
export function splitFuture(
  transactions: Transaction[],
  todayStr: string = today(),
): { future: Transaction[]; past: Transaction[] } {
  const future: Transaction[] = []
  const past:   Transaction[] = []
  for (const t of transactions) {
    (isFutureDate(t.date, todayStr) ? future : past).push(t)
  }
  return { future, past }
}

/** Bir işlemin hesabın KENDİ para biriminde bakiyeye etkisi (± işaretli).
 *  Transferin gelen bacağı ve çapraz kur dönüşümü dahil. */
export function accountDelta(account: Account, tx: Transaction): number {
  return computeTransactionEffect(account, [tx])
}

export interface DayTotals {
  /** Bakiyeyi artıran hareketlerin toplamı (gelir + gelen transfer). */
  inflow: number
  /** Bakiyeyi azaltan hareketlerin toplamı (gider + giden transfer), pozitif. */
  outflow: number
  /** inflow − outflow. */
  net: number
}

export function dayTotals(account: Account, txs: Transaction[]): DayTotals {
  let inflow = 0, outflow = 0
  for (const tx of txs) {
    const d = accountDelta(account, tx)
    if (d >= 0) inflow += d; else outflow += -d
  }
  return { inflow, outflow, net: inflow - outflow }
}

/** Tarihleri seçili sıralamaya göre dizer (tutar sıralamalarında da tarih
 *  gruplaması korunur; gün İÇİ sıralamayı çağıran belirler). */
export function sortDates(dates: string[], sort: TxSortOption): string[] {
  const asc = sort === 'date-asc' || sort === 'amount-asc'
  return [...dates].sort((a, b) => (asc ? a.localeCompare(b) : b.localeCompare(a)))
}

/** Gün içi sıralama: tutar seçenekleri tutara, diğerleri kayıt zamanına göre. */
export function sortWithinDay(txs: Transaction[], sort: TxSortOption): Transaction[] {
  if (sort === 'amount-asc' || sort === 'amount-desc') {
    return [...txs].sort((a, b) => {
      const d = Math.abs(a.amount) - Math.abs(b.amount)
      return sort === 'amount-asc' ? d : -d
    })
  }
  return [...txs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}
