import { isFlowTx } from '@/lib/utils/calculations'
import { baseAmount } from '@/lib/utils/fx'
import { toMinor, toMajor } from '@/lib/utils/money'
import { today } from '@/lib/utils/date'
import { expandByCategory } from '@/lib/utils/categorySplits'
import { compareCategoriesByName } from '@/lib/utils/categories'
import { matchesTokens, tokenize } from '@/lib/utils/boardText'
import type { Category, CategoryScope, Transaction } from '@/types'

/* ── Kategori tahtasının paylaşılan sözleşmesi ───────────────────────────────
 * Alıcılar/Aile Üyeleri tahtasıyla aynı kalıp: görünümler yalnızca SUNUM
 * katmanıdır; arama, sıralama, düzenleme/arşivleme state'i ve toplamların
 * hesabı kabukta (CategoryBoard) kalır. Tablo ile Dizin birebir aynı satırları,
 * aynı tutarlarla gösterir.
 *
 * Kategoriye özgü iki kural:
 *   1. Tutarlar ALT AĞACI kapsar (bir üst kategorinin toplamı alt
 *      kategorilerini içerir) — bütçe/rapor tarafıyla aynı kural.
 *   2. Bölünmüş işlemler önce paylarına açılır (expandByCategory); tutar bu
 *      kategoriye düşen payı gösterir, işlem sayısı ise dilimi değil GERÇEK
 *      işlemi sayar.
 * ------------------------------------------------------------------------- */

export type CategoryLevel = 0 | 1 | 2

export interface CategoryRow {
  category: Category
  level: CategoryLevel
  /** Aktif ağaçtaki üst kategori (arşivli üst varsa köke bağlanır). */
  parentId: string | undefined
  /** Üst zincir, ör. "Yeme İçme › Market"; kök kategoride ''. */
  path: string
  /** Doğrudan (arşivsiz) alt kategori sayısı. */
  childCount: number
  /** Alt ağaç dahil, akışa giren GERÇEK işlem sayısı (dilim değil). */
  flowCount: number
  /** Alt ağaç dahil, akış dışı bağlı satırlar ("+N bekleyen"). */
  pendingCount: number
  /** Alt ağaç dahil gelir/gider ve net — TRY-normalize + kuruş-exact. */
  income: number
  expense: number
  /** income − expense. Kategori detay başlığıyla aynı büyüklük. */
  net: number
  /** |net| — sıralama, ortalama ve pay hesabının tabanı. */
  magnitude: number
  /** Yalnız DOĞRUDAN bu kategoriye işlenmiş tutar (alt kategoriler hariç).
   *  Kırılımda "Doğrudan …" satırı olarak görünür; alt kategori payları + bu,
   *  üstün toplamını verir. */
  ownMagnitude: number
  /** Doğrudan bu kategoriye işlenmiş akış işlemi sayısı. */
  ownCount: number
  /** Alt ağaçtaki en son akış işleminin günü. */
  lastDate: string | null
  /** Kök kategorilerin toplam büyüklüğü içindeki pay, 0..1. */
  share: number
  /** Üst kategorisinin toplamı içindeki pay, 0..1 (kökte 0). Kırılımın
   *  okunması gereken oranı budur. */
  shareOfParent: number
}

/** Bir kategoriden köke uzanan zincir (kendisi dahil), en fazla 3 halka. */
function ancestorChain(id: string, parentOf: Map<string, string | undefined>): string[] {
  const chain: string[] = []
  let cur: string | undefined = id
  while (cur && chain.length < 3) {
    chain.push(cur)
    cur = parentOf.get(cur)
  }
  return chain
}

/**
 * Kapsamdaki (gider/gelir) aktif kategoriler için satır modeli.
 * Toplamlar isFlowTx ile süzülür — Dashboard, Raporlar ve kategori detay
 * başlığı ile aynı akış kuralı; akış dışı satırlar yok sayılmaz, pendingCount
 * olarak taşınır.
 */
export function enrichCategories(
  categories: readonly Category[],
  transactions: readonly Transaction[],
  scope: CategoryScope,
  asOf: string = today(),
): CategoryRow[] {
  const active = categories.filter(c => c.scope === scope && !c.isArchived)
  const byId = new Map(active.map(c => [c.id, c]))

  // Arşivli bir üst kategorinin altındaki aktif kategori köke bağlanmış sayılır:
  // zincir yalnız AKTİF halkalardan kurulur, böylece toplam kaybolmaz.
  const parentOf = new Map<string, string | undefined>()
  for (const c of active) {
    parentOf.set(c.id, c.parentId && byId.has(c.parentId) ? c.parentId : undefined)
  }

  const levelOf = (id: string): CategoryLevel => {
    const p = parentOf.get(id)
    if (!p) return 0
    return parentOf.get(p) ? 2 : 1
  }

  const childrenOf = new Map<string, Category[]>()
  for (const c of active) {
    const key = parentOf.get(c.id) ?? '__root__'
    const list = childrenOf.get(key)
    if (list) list.push(c)
    else childrenOf.set(key, [c])
  }
  for (const list of childrenOf.values()) list.sort(compareCategoriesByName)

  interface Acc {
    flowIds: Set<string>
    pendingIds: Set<string>
    incomeMinor: number
    expenseMinor: number
    /** Yalnız doğrudan bu kategoriye işlenmiş olanlar (alt ağaç hariç). */
    ownIds: Set<string>
    ownIncomeMinor: number
    ownExpenseMinor: number
    lastDate: string | null
  }
  const acc = new Map<string, Acc>()
  for (const c of active) {
    acc.set(c.id, {
      flowIds: new Set(), pendingIds: new Set(), incomeMinor: 0, expenseMinor: 0,
      ownIds: new Set(), ownIncomeMinor: 0, ownExpenseMinor: 0, lastDate: null,
    })
  }

  // Tek geçişte hem kendisine hem üstlerine yazılır: zincir en fazla 3 halka
  // olduğu için bu, kategori başına tüm işlemleri süzmekten çok daha ucuz.
  for (const t of expandByCategory(transactions)) {
    const cid = t.categoryId
    if (!cid || !acc.has(cid)) continue
    const flow = isFlowTx(t, asOf)
    const date = t.date.slice(0, 10)   // legacy tam-ISO datetime gün sınırında doğru kıyaslansın

    for (const id of ancestorChain(cid, parentOf)) {
      const a = acc.get(id)
      if (!a) continue
      const own = id === cid
      if (!flow) { a.pendingIds.add(t.id); continue }
      a.flowIds.add(t.id)
      if (own) a.ownIds.add(t.id)
      if (!a.lastDate || date > a.lastDate) a.lastDate = date
      // Transfer satırları hiçbir toplama girmez (yalnız sayıma) — akış
      // metriklerinin her yerdeki kuralı.
      const minor = toMinor(baseAmount(t))
      if (t.type === 'expense') {
        a.expenseMinor += minor
        if (own) a.ownExpenseMinor += minor
      } else if (t.type === 'income') {
        a.incomeMinor += minor
        if (own) a.ownIncomeMinor += minor
      }
    }
  }

  const magnitudeOf = (a: Acc) => Math.abs(toMajor(a.incomeMinor - a.expenseMinor))
  // Pay paydası = yalnız KÖK kategoriler; alt kategoriler zaten köklerin
  // içinde sayıldığı için toplamları %100'ü aşmasın.
  const rootTotal = (childrenOf.get('__root__') ?? [])
    .reduce((sum, r) => sum + magnitudeOf(acc.get(r.id)!), 0)

  const rows: CategoryRow[] = active.map(category => {
    const a = acc.get(category.id)!
    const net = toMajor(a.incomeMinor - a.expenseMinor)
    const magnitude = Math.abs(net)
    const parentId = parentOf.get(category.id)
    const parentMagnitude = parentId ? magnitudeOf(acc.get(parentId)!) : 0
    const chain = ancestorChain(category.id, parentOf).slice(1).reverse()
    return {
      category,
      level:        levelOf(category.id),
      parentId,
      path:         chain.map(id => byId.get(id)!.name).join(' › '),
      childCount:   (childrenOf.get(category.id) ?? []).length,
      flowCount:    a.flowIds.size,
      pendingCount: a.pendingIds.size,
      income:       toMajor(a.incomeMinor),
      expense:      toMajor(a.expenseMinor),
      net,
      magnitude,
      ownMagnitude: Math.abs(toMajor(a.ownIncomeMinor - a.ownExpenseMinor)),
      ownCount:     a.ownIds.size,
      lastDate:     a.lastDate,
      share:        rootTotal > 0 ? magnitude / rootTotal : 0,
      shareOfParent: parentMagnitude > 0 ? magnitude / parentMagnitude : 0,
    }
  })

  // Varsayılan düzen ağaç sırasıdır (kök → altları → torunları); 'name' dışında
  // bir sıralama seçilirse sortCategories bunu düzleştirip yeniden dizer.
  const byIdRow = new Map(rows.map(r => [r.category.id, r]))
  const ordered: CategoryRow[] = []
  const walk = (parentKey: string) => {
    for (const c of childrenOf.get(parentKey) ?? []) {
      ordered.push(byIdRow.get(c.id)!)
      walk(c.id)
    }
  }
  walk('__root__')
  return ordered
}

/* ── Arama ─────────────────────────────────────────────────────────────────── */

/** Kategori adı + üst zinciri üzerinde arar ("yeme mar" → Yeme İçme › Market). */
export function makeCategoryMatcher(query: string): (row: CategoryRow) => boolean {
  const tokens = tokenize(query)
  if (!tokens.length) return () => true
  return row => matchesTokens(`${row.path} ${row.category.name}`, tokens)
}

/* ── Sıralama ──────────────────────────────────────────────────────────────── */

export const SORT_LABELS = {
  total:  'Tutar',
  count:  'İşlem',
  recent: 'Son işlem',
  name:   'İsim',
} as const

export type SortId = keyof typeof SORT_LABELS
export const SORTS = ['total', 'count', 'recent', 'name'] as const satisfies readonly SortId[]

/**
 * 'name' ağaç sırasını korur (enrichCategories'in verdiği düzen: kök → alt →
 * torun). Diğer sıralamalar ağacı DÜZLEŞTİRİR; satırdaki "üst › alt" yolu
 * hiyerarşiyi okunur tutar.
 */
export function sortCategories(rows: CategoryRow[], sort: SortId): CategoryRow[] {
  if (sort === 'name') return rows

  const byName = (a: CategoryRow, b: CategoryRow) =>
    a.category.name.localeCompare(b.category.name, 'tr')

  const sorted = [...rows]
  switch (sort) {
    case 'total':  sorted.sort((a, b) => b.magnitude - a.magnitude || byName(a, b)); break
    case 'count':  sorted.sort((a, b) => b.flowCount - a.flowCount || byName(a, b)); break
    // Hiç işlemi olmayanlar (lastDate null) en sona.
    case 'recent': sorted.sort((a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || byName(a, b)); break
  }
  return sorted
}

/* ── Kırılım ağacı ─────────────────────────────────────────────────────────── */

export interface CategoryNode {
  row: CategoryRow
  children: CategoryNode[]
}

/** Kardeşleri aktif sıralamaya göre dizer (ağacın HER seviyesinde ayrı ayrı). */
export function sortSiblings(rows: CategoryRow[], sort: SortId): CategoryRow[] {
  const byName = (a: CategoryRow, b: CategoryRow) =>
    a.category.name.localeCompare(b.category.name, 'tr')

  const sorted = [...rows]
  switch (sort) {
    case 'total':  sorted.sort((a, b) => b.magnitude - a.magnitude || byName(a, b)); break
    case 'count':  sorted.sort((a, b) => b.flowCount - a.flowCount || byName(a, b)); break
    case 'recent': sorted.sort((a, b) =>
      (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || byName(a, b)); break
    case 'name':   sorted.sort(byName); break
  }
  return sorted
}

/**
 * Satırları kırılım ağacına dizer: kökler sıralanır, her kökün altında kendi
 * alt kategorileri AYNI ölçüte göre sıralanır. Üstü listede olmayan bir satır
 * (arama sonucu) öksüz kalmasın diye kök seviyesine çıkarılır — yolu zaten
 * satırda yazıyor.
 */
export function buildTree(rows: CategoryRow[], sort: SortId): CategoryNode[] {
  const present = new Set(rows.map(r => r.category.id))
  const childrenOf = new Map<string, CategoryRow[]>()
  const roots: CategoryRow[] = []

  for (const row of rows) {
    const pid = row.parentId
    if (pid && present.has(pid)) {
      const list = childrenOf.get(pid)
      if (list) list.push(row)
      else childrenOf.set(pid, [row])
    } else {
      roots.push(row)
    }
  }

  const build = (row: CategoryRow): CategoryNode => ({
    row,
    children: sortSiblings(childrenOf.get(row.category.id) ?? [], sort).map(build),
  })
  return sortSiblings(roots, sort).map(build)
}

/* ── Etiketler ─────────────────────────────────────────────────────────────── */

export const SCOPE_LABELS: Record<CategoryScope, string> = { expense: 'Gider', income: 'Gelir' }

export { shortDate } from '@/lib/utils/boardText'
