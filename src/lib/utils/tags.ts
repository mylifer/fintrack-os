import type { Transaction } from '@/types'

// ─── Normalization ───────────────────────────────────────────────────────────
// Tags are free-form strings. We preserve the user's chosen display casing but
// group/match case-insensitively via a Turkish-aware lowercase key, so "Tatil"
// and "tatil" collapse into one tag.

/** Trim and collapse internal whitespace. Returns '' for blank input. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** Case-insensitive grouping/matching key (Turkish locale aware). */
export function tagKey(tag: string): string {
  return normalizeTag(tag).toLocaleLowerCase('tr-TR')
}

/** Normalize a list of tags, dropping blanks and case-insensitive duplicates
 *  while keeping the first-seen display casing. */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const norm = normalizeTag(t)
    if (!norm) continue
    const key = tagKey(norm)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(norm)
  }
  return out
}

// ─── CSV serialization ─────────────────────────────────────────────────────
// Serialize with a pipe separator so a tag containing a comma survives the
// comma-delimited CSV round-trip regardless of cell quoting.

export function serializeTagsCell(tags?: readonly string[]): string {
  return dedupeTags(tags ?? []).join('|')
}

export function parseTagsCell(cell: string): string[] {
  if (!cell) return []
  return dedupeTags(cell.split('|'))
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface TagAggregate {
  tag: string      // canonical display label (most-used casing)
  key: string      // case-insensitive key
  count: number    // number of transactions carrying this tag
  income: number   // total income amount
  expense: number  // total expense amount
  volume: number   // income + expense (transfers excluded)
}

/** Aggregate all unique tags across the given transactions. A transaction is
 *  counted once per distinct tag key even if it lists the tag twice. */
export function aggregateTags(transactions: readonly Transaction[]): TagAggregate[] {
  interface Acc {
    key: string
    count: number
    income: number
    expense: number
    casings: Map<string, number>  // display casing → occurrences (insertion = first-seen)
  }
  const map = new Map<string, Acc>()

  for (const tx of transactions) {
    if (!tx.tags?.length) continue
    const seenInTx = new Set<string>()
    for (const raw of tx.tags) {
      const norm = normalizeTag(raw)
      if (!norm) continue
      const key = tagKey(norm)
      if (seenInTx.has(key)) continue
      seenInTx.add(key)

      let acc = map.get(key)
      if (!acc) {
        acc = { key, count: 0, income: 0, expense: 0, casings: new Map() }
        map.set(key, acc)
      }
      acc.count++
      if (tx.type === 'income')  acc.income  += tx.amount
      if (tx.type === 'expense') acc.expense += tx.amount
      acc.casings.set(norm, (acc.casings.get(norm) ?? 0) + 1)
    }
  }

  const result: TagAggregate[] = []
  for (const acc of map.values()) {
    // Canonical casing = most frequent; ties resolved by first-seen order.
    let best = ''
    let bestN = -1
    for (const [casing, n] of acc.casings) {
      if (n > bestN) { bestN = n; best = casing }
    }
    result.push({
      tag:     best,
      key:     acc.key,
      count:   acc.count,
      income:  acc.income,
      expense: acc.expense,
      volume:  acc.income + acc.expense,
    })
  }

  result.sort((a, b) =>
    b.count - a.count || b.volume - a.volume || a.tag.localeCompare(b.tag, 'tr'),
  )
  return result
}

// ─── Display color ───────────────────────────────────────────────────────────
// Deterministic Bauhaus-palette color per tag key, so a given tag always reads
// the same swatch across the app.

const TAG_PALETTE = [
  '#E4572E', '#F3A712', '#3B82F6', '#10B981',
  '#8B5CF6', '#EC4899', '#0EA5E9', '#EAB308',
]

export function tagColor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length]
}
