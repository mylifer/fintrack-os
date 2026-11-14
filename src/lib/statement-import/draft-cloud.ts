import type { StatementDraft } from '@/store/statement-drafts.store'

// Supabase istemcisi yalnız bulutla konuşulurken yüklenir: taslak deposu (ve
// testleri) Supabase yapılandırması olmadan da çalışsın
const client = async () => {
  const [{ supabase }, { getUserId }] = await Promise.all([import('@/lib/supabase'), import('@/lib/auth')])
  return { supabase, uid: await getUserId() }
}

/* ── Yarım kalan ekstreler: bulut eşitlemesi ─────────────────────────────────
   Taslak cihazda (localStorage) yaşamaya devam eder — çevrimdışı da çalışır.
   Ayrıca public.statement_drafts'a (0024) yazılır; açılışta iki taraf
   birleştirilir, updatedAt'i yeni olan kazanır. Silme bir damgadır (tombstone):
   öbür cihaz bir sonraki açılışta kendi kopyasını da siler.

   Tablo yoksa (migration uygulanmamış), çevrimdışıysa ya da giriş yoksa her şey
   sessizce cihazda kalır; hiçbir hata kullanıcıya yansımaz. */

const TABLE = 'statement_drafts'

export interface CloudDraftRow {
  id: string
  workspaceId: string | null
  data: StatementDraft | null
  updatedAt: string
  deleted_at: string | null
}

/** Bu cihazda silinmiş ama silinmesi henüz buluta ulaşmamış taslak */
export interface LocalTombstone { id: string; at: string }

export type PushOp = { kind: 'draft'; draft: StatementDraft } | { kind: 'delete'; id: string; at: string }

export interface MergeResult {
  drafts: StatementDraft[]
  /** Buluta gönderilecekler (bu cihazın daha yeni olduğu taslaklar ve silmeler) */
  push: PushOp[]
  /** Artık tutulması gerekmeyen yerel silme kayıtları */
  settledTombstones: string[]
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0)

/** Cihazdaki ve buluttaki taslakları birleştirir (saf). */
export function mergeDrafts(local: readonly StatementDraft[], tombstones: readonly LocalTombstone[], cloud: readonly CloudDraftRow[]): MergeResult {
  const out = new Map<string, StatementDraft>()
  const push: PushOp[] = []
  const settled: string[] = []
  const localById = new Map(local.map(d => [d.id, d]))
  const tombById = new Map(tombstones.map(t => [t.id, t]))
  const cloudById = new Map(cloud.map(r => [r.id, r]))

  for (const id of new Set([...localById.keys(), ...tombById.keys(), ...cloudById.keys()])) {
    const l = localById.get(id), t = tombById.get(id), c = cloudById.get(id)
    const cloudAlive = c && !c.deleted_at && c.data ? c : undefined

    if (t) {
      // Bu cihazda silindi: buluttaki daha sonra düzenlenmediyse silme gider
      if (cloudAlive && ms(cloudAlive.updatedAt) > ms(t.at)) { out.set(id, cloudAlive.data!); settled.push(id); continue }
      if (c?.deleted_at) settled.push(id)
      else push.push({ kind: 'delete', id, at: t.at })
      continue
    }
    if (l && c?.deleted_at && !cloudAlive) {
      // Başka cihazda silindi; bu cihazda ondan sonra düzenlenmediyse burada da silinir
      if (ms(l.updatedAt) > ms(c.deleted_at)) { out.set(id, l); push.push({ kind: 'draft', draft: l }) }
      continue
    }
    if (l && cloudAlive) {
      if (ms(cloudAlive.updatedAt) > ms(l.updatedAt)) out.set(id, cloudAlive.data!)
      else { out.set(id, l); if (ms(l.updatedAt) > ms(cloudAlive.updatedAt)) push.push({ kind: 'draft', draft: l }) }
      continue
    }
    if (l) { out.set(id, l); push.push({ kind: 'draft', draft: l }); continue }
    if (cloudAlive) out.set(id, cloudAlive.data!)
  }
  const drafts = [...out.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { drafts, push, settledTombstones: settled }
}

/** Buluttaki taslaklar; giriş yoksa, tablo yoksa ya da çevrimdışıysa null. */
export async function pullCloudDrafts(): Promise<CloudDraftRow[] | null> {
  try {
    const { supabase, uid } = await client()
    if (!uid) return null
    const { data, error } = await supabase.from(TABLE).select('id, workspaceId, data, updatedAt, deleted_at')
    if (error) return null
    return (data ?? []) as CloudDraftRow[]
  } catch {
    return null
  }
}

/** Bir değişikliği buluta yazar; başarılıysa true. */
export async function pushCloudDraft(op: PushOp): Promise<boolean> {
  try {
    const { supabase, uid } = await client()
    if (!uid) return false
    const row: Record<string, unknown> = op.kind === 'draft'
      ? { user_id: uid, id: op.draft.id, workspaceId: op.draft.workspaceId, data: op.draft, updatedAt: op.draft.updatedAt, deleted_at: null }
      : { user_id: uid, id: op.id, workspaceId: null, data: null, updatedAt: op.at, deleted_at: op.at }
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'user_id,id' })
    return !error
  } catch {
    return false
  }
}
