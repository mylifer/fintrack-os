import { isFlowTx } from '@/lib/utils/calculations'
import { baseAmount } from '@/lib/utils/fx'
import { toMinor, toMajor } from '@/lib/utils/money'
import { today } from '@/lib/utils/date'
import { getBrandDomain } from '@/lib/people/brands'
import { matchesTokens, tokenize } from '@/lib/utils/boardText'
import type { Person, PersonRole, Transaction } from '@/types'

/* ── Kişi tahtasının (Alıcılar / Aile Üyeleri) paylaşılan sözleşmesi ─────────
 * Görünümler yalnızca SUNUM katmanıdır: arama, sıralama, düzenleme/arşivleme
 * state'i ve toplamların hesabı kabukta (PeopleBoard) kalır. Böylece görünüm
 * değiştirmek listenin KAPSAMINI ya da sayıları hiç değiştirmez — Tablo ile
 * Dizin birebir aynı satırları, aynı tutarlarla gösterir.
 *
 * İki sayfa aynı kabuğu paylaşır; yalnız BOARDS'taki varyant tanımı değişir:
 * hangi işlem alanına bağlandıkları, para kolonları ve etiketler.
 * ------------------------------------------------------------------------- */

export interface PersonRow {
  person: Person
  /** Akışa giren (isFlowTx) işlem sayısı — para kolonlarıyla AYNI kümeden. */
  flowCount: number
  /** Akışa girmeyen bağlı satırlar: onay bekleyen, tarihi gelmemiş, mutabakat
   *  ghost'u, yatırım/borç anaparası. Tutarlara katılmaz ama sayıca kaybolmasın
   *  diye ayrı taşınır ("+N bekleyen" rozeti). */
  pendingCount: number
  /** TRY-normalize (baseAmount, S2/S3), kuruş-exact (S8) gelir toplamı. */
  income: number
  /** Aynı kuralla gider toplamı. */
  expense: number
  /** income − expense. Aile üyesi görünümlerinin ana para kolonu. */
  net: number
  /** En son akış işleminin günü (YYYY-MM-DD); hiç yoksa null. */
  lastDate: string | null
  /** Bu kişinin listedeki tüm kişiler içindeki gider payı, 0..1. */
  share: number
}

/**
 * Kişi başına toplamlar. Para kolonları isFlowTx ile süzülür — Dashboard,
 * Raporlar ve kişi detay başlığı ile aynı akış kuralı; akış dışı satırlar
 * yok sayılmaz, pendingCount olarak taşınır.
 *
 * `link`, işlemin hangi alanla kişiye bağlandığıdır: alıcılarda `recipientId`,
 * aile üyelerinde `familyMemberId`.
 */
export function enrichPeople(
  people: readonly Person[],
  transactions: readonly Transaction[],
  link: PersonLinkField,
  asOf: string = today(),
): PersonRow[] {
  interface Acc {
    flowCount: number
    pendingCount: number
    incomeMinor: number
    expenseMinor: number
    lastDate: string | null
  }
  const acc = new Map<string, Acc>()
  for (const p of people) {
    acc.set(p.id, { flowCount: 0, pendingCount: 0, incomeMinor: 0, expenseMinor: 0, lastDate: null })
  }

  for (const t of transactions) {
    const id = t[link]
    if (!id) continue
    const a = acc.get(id)
    if (!a) continue                       // arşivli/başka alanın kişisi
    if (!isFlowTx(t, asOf)) { a.pendingCount++; continue }

    a.flowCount++
    // slice(0,10): legacy tam-ISO datetime tarihler de gün sınırında doğru kıyaslanır.
    const date = t.date.slice(0, 10)
    if (!a.lastDate || date > a.lastDate) a.lastDate = date

    // Transfer satırları hiçbir toplama girmez (yalnız flowCount'a) — akış
    // metriklerinin her yerdeki kuralı.
    if (t.type === 'expense')     a.expenseMinor += toMinor(baseAmount(t))
    else if (t.type === 'income') a.incomeMinor  += toMinor(baseAmount(t))
  }

  let totalExpenseMinor = 0
  for (const a of acc.values()) totalExpenseMinor += a.expenseMinor

  return people.map(person => {
    const a = acc.get(person.id)!
    return {
      person,
      flowCount:    a.flowCount,
      pendingCount: a.pendingCount,
      income:       toMajor(a.incomeMinor),
      expense:      toMajor(a.expenseMinor),
      net:          toMajor(a.incomeMinor - a.expenseMinor),
      lastDate:     a.lastDate,
      share:        totalExpenseMinor > 0 ? a.expenseMinor / totalExpenseMinor : 0,
    }
  })
}

/* ── Arama ─────────────────────────────────────────────────────────────────── */

/** Ad + (varsa) favicon domain'i üzerinde arar; boşlukla ayrılan parçalar
 *  VE'lenir, böylece "mig ist" → "Migros İstanbul" bulur. */
export function makePersonMatcher(query: string): (row: PersonRow) => boolean {
  const tokens = tokenize(query)
  if (!tokens.length) return () => true
  return ({ person }) =>
    matchesTokens(`${person.name} ${person.url ?? ''} ${getBrandDomain(person.name) ?? ''}`, tokens)
}

/* ── Sıralama ──────────────────────────────────────────────────────────────── */

export const SORT_LABELS = {
  spend:  'Harcama',
  income: 'Gelir',
  count:  'İşlem',
  recent: 'Son işlem',
  name:   'İsim',
} as const

export type SortId = keyof typeof SORT_LABELS

export function sortPeople(rows: PersonRow[], sort: SortId): PersonRow[] {
  const byName = (a: PersonRow, b: PersonRow) =>
    a.person.name.localeCompare(b.person.name, 'tr')

  const sorted = [...rows]
  switch (sort) {
    case 'spend':  sorted.sort((a, b) => b.expense - a.expense || byName(a, b)); break
    case 'income': sorted.sort((a, b) => b.income - a.income || byName(a, b)); break
    case 'count':  sorted.sort((a, b) => b.flowCount - a.flowCount || byName(a, b)); break
    // Hiç işlemi olmayanlar (lastDate null) en sona.
    case 'recent': sorted.sort((a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || byName(a, b)); break
    case 'name':   sorted.sort(byName); break
  }
  return sorted
}

/* ── Varyantlar ────────────────────────────────────────────────────────────── */

export type PersonLinkField = 'recipientId' | 'familyMemberId'
export type BoardVariant = 'recipient' | 'member'

export interface BoardConfig {
  role: PersonRole
  /** İşlemi kişiye bağlayan alan. */
  link: PersonLinkField
  /** Detay sayfasının kökü. */
  basePath: string
  /** Favicon URL'si düzenlenebilir mi (markalar için anlamlı, kişiler için değil). */
  hasUrl: boolean
  /** Araç çubuğundaki sıralama seçenekleri; ilki varsayılan. */
  sorts: readonly SortId[]
  labels: {
    /** "3 alıcı" sayaç şeridi. */
    countNoun: string
    searchPlaceholder: string
    searchAria: string
    addButton: string
    addTitle: string
    editTitle: string
    nameLabel: string
    namePlaceholder: string
    /** Tablo görünümünün ilk kolon başlığı. */
    nameColumn: string
    emptyTitle: string
    emptyDescription: string
    emptyAction: string
    noMatchTitle: string
    archiveTitle: string
  }
}

export const BOARDS: Record<BoardVariant, BoardConfig> = {
  recipient: {
    role: 'recipient',
    link: 'recipientId',
    basePath: '/alicilar',
    hasUrl: true,
    sorts: ['spend', 'count', 'recent', 'name'],
    labels: {
      countNoun:         'alıcı',
      searchPlaceholder: 'Alıcı ara…',
      searchAria:        'Alıcı ara',
      addButton:         '+ Yeni Alıcı',
      addTitle:          'Yeni Alıcı',
      editTitle:         'Alıcıyı Düzenle',
      nameLabel:         'Alıcı adı',
      namePlaceholder:   'Örn. Migros',
      nameColumn:        'Alıcı',
      emptyTitle:        'Henüz alıcı eklenmedi',
      emptyDescription:  'Alıcı ekleyerek harcamalarınızı markaya/kişiye göre takip edebilirsiniz.',
      emptyAction:       'Alıcı Ekle',
      noMatchTitle:      'Eşleşen alıcı yok',
      archiveTitle:      'Alıcıyı arşivle',
    },
  },
  member: {
    role: 'family_member',
    link: 'familyMemberId',
    basePath: '/aile-uyeleri',
    hasUrl: false,
    sorts: ['spend', 'income', 'count', 'recent', 'name'],
    labels: {
      countNoun:         'üye',
      searchPlaceholder: 'Üye ara…',
      searchAria:        'Aile üyesi ara',
      addButton:         '+ Yeni Üye',
      addTitle:          'Yeni Aile Üyesi',
      editTitle:         'Aile Üyesini Düzenle',
      nameLabel:         'Üye adı',
      namePlaceholder:   'Örn. Ayşe',
      nameColumn:        'Üye',
      emptyTitle:        'Henüz aile üyesi eklenmedi',
      emptyDescription:  'Aile üyesi ekleyerek gelir ve giderleri kişi bazında takip edebilirsiniz.',
      emptyAction:       'Üye Ekle',
      noMatchTitle:      'Eşleşen üye yok',
      archiveTitle:      'Aile üyesini arşivle',
    },
  },
}

/* ── Gösterim yardımcıları ─────────────────────────────────────────────────── */

export { shortDate } from '@/lib/utils/boardText'
