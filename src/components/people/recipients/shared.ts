import { isFlowTx } from '@/lib/utils/calculations'
import { baseAmount } from '@/lib/utils/fx'
import { toMinor, toMajor } from '@/lib/utils/money'
import { today } from '@/lib/utils/date'
import { getBrandDomain } from '@/lib/people/brands'
import type { Person, Transaction } from '@/types'

/* ── Alıcılar sayfasının görünümleri arasında paylaşılan sözleşme ─────────────
 * Görünümler yalnızca SUNUM katmanıdır: arama, sıralama, düzenleme/arşivleme
 * state'i ve toplamların hesabı kabukta (RecipientsBoard) kalır. Böylece
 * görünüm değiştirmek listenin KAPSAMINI ya da sayıları hiç değiştirmez —
 * Tablo ile Dizin birebir aynı satırları, aynı tutarlarla gösterir.
 * ------------------------------------------------------------------------- */

export interface RecipientRow {
  person: Person
  /** Akışa giren (isFlowTx) işlem sayısı — para kolonlarıyla AYNI kümeden. */
  flowCount: number
  /** Akışa girmeyen bağlı satırlar: onay bekleyen, tarihi gelmemiş, mutabakat
   *  ghost'u, yatırım/borç anaparası. Tutarlara katılmaz ama sayıca kaybolmasın
   *  diye ayrı taşınır ("+N bekleyen" rozeti). */
  pendingCount: number
  /** TRY-normalize (baseAmount, S2/S3), kuruş-exact (S8) gider toplamı. */
  expense: number
  /** En son akış işleminin günü (YYYY-MM-DD); hiç yoksa null. */
  lastDate: string | null
  /** Bu alıcının tüm alıcılar içindeki gider payı, 0..1. */
  share: number
}

/**
 * Alıcı başına toplamlar. Para kolonları isFlowTx ile süzülür — Dashboard,
 * Raporlar ve alıcı detay başlığı ile aynı akış kuralı; akış dışı satırlar
 * yok sayılmaz, pendingCount olarak taşınır.
 */
export function enrichRecipients(
  people: readonly Person[],
  transactions: readonly Transaction[],
  asOf: string = today(),
): RecipientRow[] {
  interface Acc {
    flowCount: number
    pendingCount: number
    expenseMinor: number
    lastDate: string | null
  }
  const acc = new Map<string, Acc>()
  for (const p of people) {
    acc.set(p.id, { flowCount: 0, pendingCount: 0, expenseMinor: 0, lastDate: null })
  }

  for (const t of transactions) {
    const id = t.recipientId
    if (!id) continue
    const a = acc.get(id)
    if (!a) continue                       // arşivli/başka alanın alıcısı
    if (!isFlowTx(t, asOf)) { a.pendingCount++; continue }

    a.flowCount++
    // slice(0,10): legacy tam-ISO datetime tarihler de gün sınırında doğru kıyaslanır.
    const date = t.date.slice(0, 10)
    if (!a.lastDate || date > a.lastDate) a.lastDate = date

    // Yalnız gider toplanır: iki görünümün de para kolonu "Toplam Gider".
    // Gelir satırları flowCount'a girer (alıcının işlem sayısı eksik görünmesin).
    if (t.type === 'expense') a.expenseMinor += toMinor(baseAmount(t))
  }

  let totalExpenseMinor = 0
  for (const a of acc.values()) totalExpenseMinor += a.expenseMinor

  return people.map(person => {
    const a = acc.get(person.id)!
    return {
      person,
      flowCount:    a.flowCount,
      pendingCount: a.pendingCount,
      expense:      toMajor(a.expenseMinor),
      lastDate:     a.lastDate,
      share:        totalExpenseMinor > 0 ? a.expenseMinor / totalExpenseMinor : 0,
    }
  })
}

/* ── Arama ─────────────────────────────────────────────────────────────────── */

// Türkçe İ/ı için locale-duyarlı küçük harf ("İkea" ↔ "ikea").
const lc = (s: string) => s.toLocaleLowerCase('tr-TR')

/** Ad + (varsa) favicon domain'i üzerinde arar; boşlukla ayrılan parçalar
 *  VE'lenir, böylece "mig ist" → "Migros İstanbul" bulur. */
export function makeRecipientMatcher(query: string): (row: RecipientRow) => boolean {
  const tokens = lc(query).trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return () => true
  return ({ person }) => {
    const hay = lc(`${person.name} ${person.url ?? ''} ${getBrandDomain(person.name) ?? ''}`)
    return tokens.every(t => hay.includes(t))
  }
}

/** Vurgulama için: adın içinde eşleşen ilk parçanın [başlangıç, bitiş] aralığı. */
export function matchRange(name: string, query: string): [number, number] | null {
  const tokens = lc(query).trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return null
  const hay = lc(name)
  for (const t of tokens) {
    const i = hay.indexOf(t)
    if (i >= 0) return [i, i + t.length]
  }
  return null
}

/* ── Sıralama ──────────────────────────────────────────────────────────────── */

export const SORTS = [
  { id: 'spend',  label: 'Harcama'    },
  { id: 'count',  label: 'İşlem'      },
  { id: 'recent', label: 'Son işlem'  },
  { id: 'name',   label: 'İsim'       },
] as const

export type SortId = typeof SORTS[number]['id']

export function sortRecipients(rows: RecipientRow[], sort: SortId): RecipientRow[] {
  const byName = (a: RecipientRow, b: RecipientRow) =>
    a.person.name.localeCompare(b.person.name, 'tr')

  const sorted = [...rows]
  switch (sort) {
    case 'spend':  sorted.sort((a, b) => b.expense - a.expense || byName(a, b)); break
    case 'count':  sorted.sort((a, b) => b.flowCount - a.flowCount || byName(a, b)); break
    // Hiç işlemi olmayanlar (lastDate null) en sona.
    case 'recent': sorted.sort((a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || byName(a, b)); break
    case 'name':   sorted.sort(byName); break
  }
  return sorted
}

/* ── Gösterim yardımcıları ─────────────────────────────────────────────────── */

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

/** '2026-08-14' → '14 Ağu'; aynı yıl değilse '14 Ağu 25'. */
export function shortDate(iso: string | null, asOf: string = today()): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  const label = `${Number(d)} ${MONTHS_TR[Number(m) - 1]}`
  return y === asOf.slice(0, 4) ? label : `${label} ${y.slice(2)}`
}
