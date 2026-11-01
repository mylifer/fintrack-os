import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { BatchOp } from '@/lib/sync/engine'
import type { Person, Transaction } from '@/types'
import { txIdFromSeed, type Action, type DraftTx, type PlanRow } from './classify'

/* ── Onaylanan kararlardan tek seferlik yazım ────────────────────────────────
   SAF: kararlar + düzenlemeler → localBatch işlemleri ve geri alma işlemleri.
   Hepsi tek IndexedDB işleminde yazılır (ya hepsi ya hiçbiri), outbox buluta
   taşır. Kimlikler satırdan türetildiği için aynı onay iki kez gönderilse de
   aynı satırlar yazılır (çift kayıt oluşmaz). */

export interface RowEdit {
  description?: string
  recipientId?: string | null
  /** Yeni alıcı adı (recipientId yerine) */
  newRecipient?: string
  categoryId?: string
  familyMemberId?: string | null
  fromAccountId?: string
}

export interface CommitInput {
  rows: readonly PlanRow[]
  /** Satır anahtarı → seçilen seçenek indeksi */
  choices: Readonly<Record<string, number>>
  edits: Readonly<Record<string, RowEdit>>
  accountId: string
  existing: ReadonlyMap<string, Transaction>
  people: readonly Person[]
  nowIso: string
  todayStr: string
  /** Yeni alıcı kimliği üretici (testte sabit) */
  newId?: () => string
}

export interface CommitResult {
  ops: BatchOp[]
  undo: BatchOp[]
  createdTxIds: string[]
  createdPeople: Person[]
  deletedTxIds: string[]
  patchedTxIds: string[]
  /** "Girme" kararı verilen satırların sabit anahtarları (bir dahaki yüklemede sorulmaz) */
  skippedKeys: string[]
  /** Onaylanamaz: kategori seçilmemiş vb. */
  problems: { rowKey: string; message: string }[]
}

/** Seçili seçenek: kullanıcı seçimi, yoksa satırın varsayılanı. */
export function selectedOption(row: PlanRow, choices: Readonly<Record<string, number>>): number | null {
  return choices[row.key] ?? row.defaultOption
}

function applyEdit(d: DraftTx, e: RowEdit | undefined): DraftTx {
  if (!e || !d.editable) return d.fromAccountId && e?.fromAccountId ? { ...d, fromAccountId: e.fromAccountId } : d
  const out = { ...d }
  if (e.description !== undefined) out.description = e.description
  // Var olan alıcı seçildiyse (null = alıcısız) yeni alıcı adı yok sayılır
  if (e.recipientId !== undefined) { out.recipientId = e.recipientId; out.newRecipient = undefined }
  else if (e.newRecipient !== undefined) { out.newRecipient = e.newRecipient.trim() || undefined; out.recipientId = null }
  if (e.categoryId !== undefined) out.categoryId = e.categoryId
  if (e.familyMemberId !== undefined) out.familyMemberId = e.familyMemberId
  return out
}

export function buildCommit(input: CommitInput): CommitResult {
  const { nowIso, todayStr, accountId } = input
  const newId = input.newId ?? (() => crypto.randomUUID())
  const ops: BatchOp[] = []
  const undo: BatchOp[] = []
  const createdTxIds: string[] = []
  const createdPeople: Person[] = []
  const deleted = new Set<string>()
  const patched = new Map<string, Partial<Transaction>>()
  const problems: CommitResult['problems'] = []
  const skippedKeys: string[] = []

  // Aynı adlı yeni alıcı tek kişi olur; var olan alıcıyla aynı adsa o kullanılır
  const personByName = new Map<string, string>()
  for (const p of input.people) if (p.role === 'recipient' && !p.deleted_at) personByName.set(foldText(p.name), p.id)
  const recipientFor = (name: string): string => {
    const key = foldText(name)
    const found = personByName.get(key)
    if (found) return found
    const person: Person = { id: newId(), name: name.trim(), role: 'recipient', createdAt: nowIso }
    createdPeople.push(person)
    personByName.set(key, person.id)
    return person.id
  }

  const txBase = (d: DraftTx) => ({
    currency: 'TRY' as const,
    accountId,
    description: d.description.trim(),
    merchant: d.merchant,
    recipientId: d.newRecipient ? recipientFor(d.newRecipient) : (d.recipientId ?? null),
    categoryId: d.categoryId,
    familyMemberId: d.familyMemberId ?? null,
    tags: d.tags?.length ? [...new Set(d.tags)] : undefined,
    refundOfId: d.refundOfId,
    createdAt: nowIso,
    updatedAt: nowIso,
  })

  const create = (rowKey: string, d: DraftTx) => {
    if (d.type === 'expense' && !d.categoryId) {
      problems.push({ rowKey, message: 'Kategori seçilmedi' })
      return
    }
    if (!d.description.trim()) {
      problems.push({ rowKey, message: 'Açıklama boş' })
      return
    }
    const push = (tx: Transaction) => {
      if (input.existing.has(tx.id) || createdTxIds.includes(tx.id)) return   // kimlikten: zaten var
      ops.push({ kind: 'upsert', table: 'transactions', entity: tx })
      createdTxIds.push(tx.id)
    }
    if (d.type === 'transfer') {
      push({
        id: txIdFromSeed(d.idSeed), type: 'transfer', amount: Math.abs(d.amount), amountTry: Math.abs(d.amount),
        currency: 'TRY', date: d.date, accountId: d.fromAccountId!, toAccountId: accountId, description: d.description,
        isInstallment: false, createdAt: nowIso, updatedAt: nowIso,
      })
      return
    }
    const base = txBase(d)
    if (d.installments) {
      const groupId = txIdFromSeed(d.idSeed)
      const count = d.installments.amounts.length
      d.installments.amounts.forEach((amount, i) => {
        const date = d.installments!.dates[i]
        push({
          ...base, id: txIdFromSeed(d.idSeed, i + 1), type: 'expense', amount, amountTry: amount, date,
          isInstallment: true, installTotal: count, installIndex: i + 1, installGroupId: groupId,
          // Taksitler onay kapısında beklemez (addInstallmentGroup ile aynı)
          approvalStatus: 'approved', approvedAt: nowIso,
        })
      })
      return
    }
    if (d.installmentOf) {
      push({
        ...base, id: txIdFromSeed(d.idSeed), type: 'expense', amount: d.amount, amountTry: d.amount, date: d.date,
        isInstallment: true, installTotal: d.installmentOf.count, installIndex: d.installmentOf.index, installGroupId: d.installmentOf.groupId,
        approvalStatus: 'approved', approvedAt: nowIso,
      })
      return
    }
    push({
      ...base, id: txIdFromSeed(d.idSeed), type: 'expense', amount: d.amount, amountTry: d.amount, date: d.date,
      isInstallment: false,
      ...(d.date > todayStr ? { approvalStatus: 'approved' as const, approvedAt: nowIso } : {}),
    })
  }

  const run = (rowKey: string, a: Action, edit: RowEdit | undefined) => {
    if (a.type === 'create') create(rowKey, applyEdit(a.draft, edit))
    else if (a.type === 'delete') a.txIds.forEach(id => { if (input.existing.has(id)) deleted.add(id) })
    else if (input.existing.has(a.txId)) patched.set(a.txId, { ...(patched.get(a.txId) ?? {}), ...a.patch })
  }

  for (const row of input.rows) {
    const sel = selectedOption(row, input.choices)
    if (row.status === 'review' && sel === null) {
      problems.push({ rowKey: row.key, message: 'Karar verilmedi' })
      continue
    }
    const chosen = sel !== null ? row.options[sel] : undefined
    if ((row.status === 'review' || row.status === 'new') && chosen && chosen.actions.length === 0) skippedKeys.push(row.stableKey)
    for (const a of chosen?.actions ?? []) run(row.key, a, input.edits[row.key])
    for (const a of row.sideEffects) run(row.key, a, undefined)
  }

  // Yeni alıcılar işlemlerden ÖNCE (yabancı anahtar sırası)
  const peopleOps: BatchOp[] = createdPeople.map(p => ({ kind: 'upsert', table: 'people', entity: p }))
  ops.unshift(...peopleOps)

  for (const [id, patch] of patched) {
    if (deleted.has(id)) continue
    const prev = input.existing.get(id)!
    const p: Record<string, unknown> = { ...patch }
    if (patch.approvalStatus === 'approved') p.approvedAt = nowIso
    if (patch.amount !== undefined) p.amountTry = patch.amount
    ops.push({ kind: 'patch', table: 'transactions', id, patch: p })
    const back: Record<string, unknown> = {}
    for (const k of Object.keys(p)) back[k] = (prev as unknown as Record<string, unknown>)[k] ?? null
    undo.push({ kind: 'patch', table: 'transactions', id, patch: back })
  }
  if (deleted.size) {
    ops.push({ kind: 'patchMany', table: 'transactions', ids: [...deleted], patch: { deleted_at: nowIso } })
    undo.push({ kind: 'patchMany', table: 'transactions', ids: [...deleted], patch: { deleted_at: null } })
  }
  if (createdTxIds.length) undo.push({ kind: 'patchMany', table: 'transactions', ids: [...createdTxIds], patch: { deleted_at: nowIso } })
  if (createdPeople.length) undo.push({ kind: 'patchMany', table: 'people', ids: createdPeople.map(p => p.id), patch: { deleted_at: nowIso } })

  return { ops, undo, createdTxIds, createdPeople, deletedTxIds: [...deleted], patchedTxIds: [...patched.keys()].filter(id => !deleted.has(id)), skippedKeys, problems }
}

/** Kart borcuna net etki (önizleme özeti için): + borç artar. */
export function commitEffect(ops: readonly BatchOp[], accountId: string, existing: ReadonlyMap<string, Transaction>): number {
  let m = 0
  for (const op of ops) {
    if (op.kind === 'upsert' && op.table === 'transactions') {
      const t = op.entity as Transaction
      if (t.type === 'expense' && t.accountId === accountId) m += toMinor(t.amount)
      if (t.type === 'transfer' && t.toAccountId === accountId) m -= toMinor(t.amount)
    }
    if (op.kind === 'patchMany' && op.table === 'transactions' && op.patch.deleted_at) {
      for (const id of op.ids) { const t = existing.get(id); if (t?.type === 'expense' && t.accountId === accountId) m -= toMinor(t.amount) }
    }
  }
  return toMajor(m)
}
