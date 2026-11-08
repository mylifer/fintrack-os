import type { Category } from '@/types'

/** Türkçe alfabetik kategori sıralaması (ç, ğ, ı/İ, ö, ş, ü doğru konumlanır). */
export const compareCategoriesByName = (a: Category, b: Category) =>
  a.name.localeCompare(b.name, 'tr')

/**
 * Bir kategorinin altındaki derinlik: yaprak → 0, çocuğu var → 1, torunu var → 2.
 * Taşıma koruması için: yeni seviye + alt ağaç yüksekliği 2'yi aşarsa 4. seviye oluşur.
 */
export function categorySubtreeHeight(id: string, categories: readonly Category[]): number {
  const heightOf = (cid: string, seen: Set<string>): number => {
    if (seen.has(cid)) return 0
    seen.add(cid)
    let max = -1
    for (const c of categories) {
      if (c.parentId === cid) max = Math.max(max, heightOf(c.id, seen))
    }
    return max + 1
  }
  return heightOf(id, new Set())
}
