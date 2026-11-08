import type { Category } from '@/types'

/* ── Alt ağaç arşivleme ──────────────────────────────────────────────────────
 * Bir üst kategori arşivlenince alt ağacı da arşivlenir — ama yalnız o an
 * AKTİF olan torunlar. Daha önce ayrıca arşivlenmiş bir alt kategori bu
 * işlemin parçası değildir; geri alma/geri yükleme onu diriltmemeli.
 *
 * Birlikte arşivlenen id'ler kök id'siyle bu cihazda saklanır (localStorage);
 * "Geri Al" yalnız o grubu geri getirir. Kayıt yoksa (eski arşiv, başka cihaz)
 * eski davranışa düşülür: arşivli alt ağacın tamamı.
 * ------------------------------------------------------------------------- */

/** Kök + tüm torunlar (arşiv durumundan bağımsız), kökten yapraklara. */
export function subtreeIds(rootId: string, categories: readonly Category[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push(id)
    for (const c of categories) if (c.parentId === id) walk(c.id)
  }
  walk(rootId)
  return out
}

/** Arşivlenecek id'ler: kök + şu an aktif torunlar, YAPRAKLARDAN köke. */
export function archivableSubtreeIds(rootId: string, categories: readonly Category[]): string[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  return subtreeIds(rootId, categories)
    .filter(id => id === rootId || !byId.get(id)?.isArchived)
    .reverse()
}

/**
 * Geri yüklenecek id'ler: birlikte arşivlenen grup biliniyorsa yalnız onun hâlâ
 * arşivli (ve hâlâ bu alt ağaçta) olan üyeleri; bilinmiyorsa arşivli alt ağacın
 * tamamı. Kök her zaman dahildir.
 */
export function restorableSubtreeIds(
  rootId: string,
  categories: readonly Category[],
  group?: readonly string[] | null,
): string[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const allowed = group ? new Set(group) : null
  return subtreeIds(rootId, categories).filter(id =>
    id === rootId || (byId.get(id)?.isArchived && (!allowed || allowed.has(id))),
  )
}

const GROUPS_KEY = 'categories.archiveGroups'

function readGroups(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

function writeGroups(groups: Record<string, string[]>) {
  try { window.localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)) } catch { /* özel pencere: yoksay */ }
}

export function saveArchiveGroup(rootId: string, ids: readonly string[]) {
  writeGroups({ ...readGroups(), [rootId]: [...ids] })
}

export function loadArchiveGroup(rootId: string): string[] | null {
  const g = readGroups()[rootId]
  return Array.isArray(g) ? g : null
}

export function clearArchiveGroup(rootId: string) {
  const groups = readGroups()
  if (!(rootId in groups)) return
  delete groups[rootId]
  writeGroups(groups)
}
