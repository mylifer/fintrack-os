import type { BatchOp } from '@/lib/sync/engine'
import type { Transaction } from '@/types'
import type { PlanRow } from './classify'
import { buildCommit, selectedOption, type CommitInput, type CommitResult, type RowChoices, type RowEdit } from './commit'

/* ── Yüklenmiş ekstreyi "ilk yüklendiği haliyle" açmak ───────────────────────
   Onaylanmış ekstre bugünkü kayıtlarla karşılaştırılırsa, onun girdiği işlemler
   "Zaten sistemde", girilmeyenler "Girme (önceki kararın)" görünür: hangi satıra
   hangi kararın verildiği kaybolur. Burada liste onay anındaki kayıtlarla kurulur:

   - bu ekstrenin onayında girilen işlemler (createdTxIds) ve onaydan SONRA
     sisteme giren işlemler eşleşmeden çıkarılır,
   - bu ekstrede verilen "girme" kararları hafızadan düşülür (satır yeniden
     karar satırı olur, kayıtlı karar "Girme" olarak görünür).

   Üstüne taslağın kararları ve düzenlemeleri konunca liste ilk yüklemedeki gibi,
   verilen kararlarla görünür. Kullanıcı bir kararı değiştirip kaydederse yalnız
   DEĞİŞEN satırlar yazılır (buildHistoryCommit): değişmeyen satırlar ve onların
   sonradan düzenlenmiş/silinmiş işlemleri olduğu gibi kalır. */

export interface CommittedBaseline {
  /** Bu ekstrenin onaylarında girilen işlemler */
  ownTxIds: ReadonlySet<string>
  /** Son onay anı: bundan sonra sisteme giren işlemler o gün yoktu */
  committedAt: string
  /** Onaylanmış kararlar ve düzenlemeler (açılış anındaki hali) */
  choices: Readonly<RowChoices>
  edits: Readonly<Record<string, RowEdit>>
}

/** Onay anındaki kayıtlar: bu ekstrenin girdikleri ve sonradan girilenler hariç */
export function transactionsAsOf(txs: readonly Transaction[], base: Pick<CommittedBaseline, 'ownTxIds' | 'committedAt'>): Transaction[] {
  return txs.filter(t => !base.ownTxIds.has(t.id) && !(t.createdAt && t.createdAt > base.committedAt))
}

/** "Girme" hafızasından bu ekstrede karar verilmiş satırların anahtarları düşülür */
export function skippedAsOf(skipped: ReadonlySet<string>, rows: readonly Pick<PlanRow, 'key' | 'stableKey'>[], choices: Readonly<RowChoices>): Set<string> {
  const own = new Set(rows.filter(r => choices[r.key] !== undefined).map(r => r.stableKey))
  return new Set([...skipped].filter(k => !own.has(k)))
}

const optionKeyOf = (row: PlanRow, choices: Readonly<RowChoices>) => {
  const i = selectedOption(row, choices)
  return i === null ? null : row.options[i]?.key ?? null
}

const sameEdit = (a: RowEdit | undefined, b: RowEdit | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/** Kararı ya da düzenlemesi onaylanmış halinden farklı olan satırlar */
export function changedRows(rows: readonly PlanRow[], choices: Readonly<RowChoices>, edits: Readonly<Record<string, RowEdit>>, base: Pick<CommittedBaseline, 'choices' | 'edits'>): PlanRow[] {
  return rows.filter(r => optionKeyOf(r, choices) !== optionKeyOf(r, base.choices) || !sameEdit(edits[r.key], base.edits[r.key]))
}

export interface HistoryCommitResult extends CommitResult {
  /** Değişen satır sayısı */
  changed: number
  /** Önceden "girme" denip artık girilen satırlar (hafızadan silinir) */
  unskippedKeys: string[]
  /** Yeniden yazılan (kararı/düzenlemesi değişen) eski kayıtlar */
  rewrittenTxIds: string[]
}

export interface HistoryCommitInput extends CommitInput {
  base: CommittedBaseline
  /** Bugünkü kayıtlarla kurulan plandaki eşleşmeler (stableKey → işlem kimlikleri):
   *  sonradan başka yoldan girilmiş satır yeniden girilmesin */
  liveMatches: ReadonlyMap<string, readonly string[]>
}

/** Yalnız değişen satırları yazar. Değişen satırın bu ekstreyle girilmiş eski
 *  kaydı yeni kararla yeniden yazılır (aynı kimlik), yeni karar onu girmiyorsa silinir. */
export function buildHistoryCommit(input: HistoryCommitInput): HistoryCommitResult {
  const { base } = input
  const rows = changedRows(input.rows, input.choices, input.edits, base)

  // Değişen satırların eski kararla girdiği (ve hâlâ duran) kayıtlar
  const before = buildCommit({ ...input, rows, choices: base.choices, edits: base.edits, existing: new Map(), newId: () => 'prev' })
  const prevIds = before.createdTxIds.filter(id => base.ownTxIds.has(id) && input.existing.has(id))
  const existing = new Map(input.existing)
  for (const id of prevIds) existing.delete(id)

  const res = buildCommit({ ...input, rows, existing })

  // Sonradan başka bir kayıtla girilmiş satır: yeniden girilirse mükerrer olur
  for (const r of rows) {
    const live = input.liveMatches.get(r.stableKey)?.filter(id => !base.ownTxIds.has(id)) ?? []
    const sel = selectedOption(r, input.choices)
    const creates = sel !== null && r.options[sel]?.actions.some(a => a.type === 'create')
    if (creates && live.length) res.problems.push({ rowKey: r.key, message: 'Bu satır sonradan başka bir kayıtla sisteme girilmiş; mükerrer olmasın diye önce o kaydı silin' })
  }

  const rewritten = new Set(res.createdTxIds.filter(id => prevIds.includes(id)))
  const fresh = res.createdTxIds.filter(id => !rewritten.has(id))
  const drop = prevIds.filter(id => !rewritten.has(id))

  // Yeniden yazılan kaydın ilk giriş zamanı korunur
  const ops: BatchOp[] = res.ops.map(op => {
    if (op.kind !== 'upsert' || op.table !== 'transactions' || !rewritten.has((op.entity as Transaction).id)) return op
    const prev = input.existing.get((op.entity as Transaction).id)!
    return { ...op, entity: { ...(op.entity as Transaction), createdAt: prev.createdAt } }
  })
  // Geri alma: yeni girilenler silinir, yeniden yazılanlar eski haline döner
  const undo: BatchOp[] = res.undo.filter(op => !(op.kind === 'patchMany' && op.table === 'transactions' && op.patch.deleted_at && op.ids.some(id => res.createdTxIds.includes(id))))
  if (fresh.length) undo.push({ kind: 'patchMany', table: 'transactions', ids: fresh, patch: { deleted_at: input.nowIso } })
  for (const id of rewritten) undo.push({ kind: 'upsert', table: 'transactions', entity: input.existing.get(id)! })
  if (drop.length) {
    ops.push({ kind: 'patchMany', table: 'transactions', ids: drop, patch: { deleted_at: input.nowIso } })
    undo.push({ kind: 'patchMany', table: 'transactions', ids: drop, patch: { deleted_at: null } })
  }

  const wasSkipped = new Set(rows.filter(r => {
    const i = selectedOption(r, base.choices)
    return i !== null && r.options[i]?.actions.length === 0
  }).map(r => r.stableKey))
  const unskippedKeys = [...wasSkipped].filter(k => !res.skippedKeys.includes(k))

  return {
    ...res,
    ops, undo,
    createdTxIds: fresh,
    deletedTxIds: [...res.deletedTxIds, ...drop],
    patchedTxIds: [...res.patchedTxIds, ...rewritten],
    changed: rows.length,
    unskippedKeys,
    rewrittenTxIds: [...rewritten],
  }
}
