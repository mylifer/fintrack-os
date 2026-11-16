'use client'

import { create } from 'zustand'
import { deterministicUuid } from '@/lib/utils/id'
import type { ParsedStatement } from '@/lib/statement-import/statement'
import type { RowChoices, RowEdit } from '@/lib/statement-import/commit'
import { mergeDrafts, pullCloudDrafts, pushCloudDraft, type LocalTombstone, type PushOp } from '@/lib/statement-import/draft-cloud'

/* ── Yarım kalan ekstreler ───────────────────────────────────────────────────
   Yüklenip onaylanmayan ekstre kaybolmasın: ayrıştırılmış ekstre, seçilen
   hesap, verilen kararlar ve düzenlemeler her değişiklikte taslak olarak
   saklanır; onaylanınca silinir. Sayfa: /ekstre-yukle/taslaklar.

   Taslak önce BU cihazda (localStorage) durur — çevrimdışı da çalışır — ve
   buluta da yazılır (statement_drafts, 0024; bkz. lib/statement-import/
   draft-cloud.ts): başka cihazda Yarım Kalanlar'dan devam edilir. Açılışta
   cihaz ve bulut birleştirilir, yeni olan kazanır. Silme bulutta damgadır;
   buluta ulaşana kadar cihazda bir silme kaydı tutulur (taslak geri gelmesin).
   Çıkışta clearBrowserStorage tüm localStorage'ı sildiği için önceki
   kullanıcının taslakları cihazda kalmaz (buluttakiler kullanıcıya özeldir).

   Kimlik ekstreden türetilir (banka + kesim + kartlar + dönem borcu): aynı
   ekstre yeniden yüklenirse yeni taslak açılmaz, eskisinin kararları geri gelir. */

const KEY = 'fintrack:stmt-drafts'
const DELETED_KEY = 'fintrack:stmt-drafts-deleted'
// v2: kararlar seçenek indeksi yerine seçenek anahtarıyla saklanır. v1 taslakları
// korunur ama kararları atılır (eski indeks yeniden kurulan planda başka bir
// seçeneğe denk gelebilir); satırlar yeniden sorulur.
const VERSION = 2
const LIMIT = 20

export interface DraftProgress {
  /** Karar gereken satır sayısı */
  review: number
  /** Henüz karar verilmemiş olan */
  pending: number
  /** Onaylanırsa girilecek kayıt sayısı */
  create: number
}

export interface StatementDraft {
  id: string
  workspaceId: string | null
  fileName: string
  statement: ParsedStatement
  accountId: string
  choices: RowChoices
  edits: Record<string, RowEdit>
  progress: DraftProgress
  createdAt: string
  updatedAt: string
  /** Onaylandığı an: onaylanan ekstre silinmez, "Yüklenen Ekstreler"de kalır
   *  (yoksa yarım kalan taslaktır) */
  committedAt?: string
  /** Bu ekstrenin onaylarında girilen işlemler (yeniden onaylanınca birleşir) */
  createdTxIds?: string[]
}

/** Onaylanmış (yüklenmiş) ekstre mi, yoksa yarım kalan taslak mı */
export const isCommitted = (d: Pick<StatementDraft, 'committedAt'>) => !!d.committedAt

/** Saklanan en fazla yüklenmiş ekstre */
const COMMITTED_LIMIT = 120

/** Sınır yarım kalanlar ve yüklenenler için ayrı uygulanır: çok sayıda onaylanmış
 *  ekstre yarım kalanları itip silmesin (ve tersi). */
function cap(drafts: StatementDraft[]): StatementDraft[] {
  let open = 0, done = 0
  return drafts.filter(d => (isCommitted(d) ? ++done <= COMMITTED_LIMIT : ++open <= LIMIT))
}

/** Taslak kimliği ekstreden ve çalışma alanından türetilir: aynı ekstre iki
 *  alanda yüklenirse taslakları birbirinin üzerine yazmaz. `workspaceId`
 *  verilmezse eski (alansız) kimlik döner — önceki taslaklar böyle bulunur. */
export function draftIdFor(st: ParsedStatement, workspaceId?: string | null): string {
  return idFrom(st, workspaceId, true)
}

function idFrom(st: ParsedStatement, workspaceId: string | null | undefined, withKind: boolean): string {
  // Dönem içi liste ekstreden ayrı kaydedilir: aynı gün indirilen liste ile
  // ekstre (aynı kart, aynı tarih) asla aynı kimliğe düşmez
  const kind = withKind && statementKind(st) === 'period' ? ':period' : ''
  const base = `stmt-draft:${st.bank}:${st.statementDate}:${st.account?.iban ?? st.cards.join(',')}:${st.summary?.debt ?? st.check.expected}${kind}`
  return deterministicUuid(workspaceId ? `${base}:ws:${workspaceId}` : base)
}

/** Bu ekstrenin önceden kaydedilmiş olabileceği kimlikler, öncelik sırasıyla:
 *  bu alanın kimliği, alansız (eski) kimlik ve dönem içi liste ayrılmadan
 *  önceki kimlikler. Bulunan taslağın türü ekstreyle aynı olmalı (çağıran bakar). */
export function draftIdCandidates(st: ParsedStatement, workspaceId?: string | null): string[] {
  const ids = [idFrom(st, workspaceId, true), idFrom(st, null, true), idFrom(st, workspaceId, false), idFrom(st, null, false)]
  return [...new Set(ids)]
}

/** Kaydedilen dosyanın türü: kesilmiş ekstre (kart ekstresi, hesap dökümü) ya da
 *  henüz ekstresi kesilmemiş dönem içi işlem listesi */
export type StatementKind = 'statement' | 'period'
export const statementKind = (st: Pick<ParsedStatement, 'provisional'>): StatementKind => (st.provisional ? 'period' : 'statement')

function read(): StatementDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) as { v?: number; drafts?: unknown } : null
    if (!parsed || (parsed.v !== VERSION && parsed.v !== 1) || !Array.isArray(parsed.drafts)) return []
    const drafts = (parsed.drafts as StatementDraft[]).filter(d => d && typeof d.id === 'string' && d.statement && Array.isArray(d.statement.lines))
    return parsed.v === 1 ? drafts.map(d => ({ ...d, choices: {} })) : drafts
  } catch {
    return []
  }
}

function write(drafts: StatementDraft[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, drafts }))
  } catch { /* dolu ya da kapalı: taslak yalnız bu oturumda kalır */ }
}

function readDeleted(): LocalTombstone[] {
  if (typeof window === 'undefined') return []
  try {
    const arr = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]') as unknown
    return Array.isArray(arr) ? arr.filter((t): t is LocalTombstone => !!t && typeof t.id === 'string' && typeof t.at === 'string') : []
  } catch {
    return []
  }
}

function writeDeleted(list: LocalTombstone[]): void {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(list.slice(-200))) } catch { /* yok say */ }
}

// Taslak her düzenlemede kaydedilir; buluta kısa bir beklemeyle tek seferde gider
const PUSH_DELAY = 1500
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function schedule(op: PushOp): void {
  const id = op.kind === 'draft' ? op.draft.id : op.id
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => { timers.delete(id); void send(op) }, op.kind === 'delete' ? 0 : PUSH_DELAY))
}

async function send(op: PushOp): Promise<void> {
  const ok = await pushCloudDraft(op)
  // Silme buluta ulaştıysa yerel silme kaydı artık gerekmez
  if (ok && op.kind === 'delete') writeDeleted(readDeleted().filter(t => t.id !== op.id))
}

let syncing: Promise<void> | null = null

interface DraftsState {
  drafts: StatementDraft[]
  loaded: boolean
  load: () => void
  /** Bulutla birleştir (açılışta kendiliğinden; Yarım Kalanlar açılınca yeniden) */
  sync: () => Promise<void>
  get: (id: string) => StatementDraft | undefined
  save: (draft: Omit<StatementDraft, 'createdAt' | 'updatedAt' | 'committedAt' | 'createdTxIds'>) => void
  /** Ekstre onaylandı: silinmez, yüklenen ekstre olarak saklanır */
  markCommitted: (id: string, createdTxIds: readonly string[]) => void
  /** Onay geri alındı: ekstre onay öncesindeki haline döner (yoksa silinir) */
  restore: (id: string, before: StatementDraft | undefined) => void
  /** Yüklenen ekstre geri alındı (kayıtları silindi): ekstre, kararlarıyla
   *  birlikte yarım kalan taslağa döner; hesap değiştirilip yeniden onaylanabilir */
  uncommit: (id: string) => void
  remove: (id: string) => void
}

export const useStatementDraftsStore = create<DraftsState>()((set, get) => {
  /** Taslağı yazar (cihaz + bulut), en yeni başta */
  const put = (next: StatementDraft) => {
    const drafts = cap([next, ...get().drafts.filter(d => d.id !== next.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    write(drafts)
    set({ drafts })
    schedule({ kind: 'draft', draft: next })
  }
  return {
  drafts: [],
  loaded: false,

  load: () => {
    if (get().loaded) return
    set({ drafts: read(), loaded: true })
    void get().sync()
  },

  sync: () => {
    if (syncing) return syncing
    syncing = (async () => {
      const cloud = await pullCloudDrafts()
      if (!cloud) return
      // Bekleme sırasında yapılan yerel değişiklikler kaybolmasın: güncel hali birleştir
      const { drafts, push, settledTombstones } = mergeDrafts(read(), readDeleted(), cloud)
      const kept = cap(drafts)
      write(kept)
      if (settledTombstones.length) writeDeleted(readDeleted().filter(t => !settledTombstones.includes(t.id)))
      set({ drafts: kept, loaded: true })
      for (const op of push) void send(op)
    })().finally(() => { syncing = null })
    return syncing
  },

  get: (id) => {
    get().load()
    return get().drafts.find(d => d.id === id)
  },

  save: (draft) => {
    get().load()
    const now = new Date().toISOString()
    const prev = get().drafts.find(d => d.id === draft.id)
    // Yüklenmiş ekstre yeniden açılıp düzenlenince yüklenmiş olarak kalır
    const next: StatementDraft = {
      ...draft, createdAt: prev?.createdAt ?? now, updatedAt: now,
      ...(prev?.committedAt ? { committedAt: prev.committedAt, createdTxIds: prev.createdTxIds } : {}),
    }
    put(next)
  },

  markCommitted: (id, createdTxIds) => {
    get().load()
    const prev = get().drafts.find(d => d.id === id)
    if (!prev) return
    const now = new Date().toISOString()
    put({ ...prev, committedAt: now, updatedAt: now, createdTxIds: [...new Set([...(prev.createdTxIds ?? []), ...createdTxIds])] })
  },

  restore: (id, before) => {
    if (!before) { get().remove(id); return }
    get().load()
    put({ ...before, updatedAt: new Date().toISOString() })
  },

  uncommit: (id) => {
    get().load()
    const prev = get().drafts.find(d => d.id === id)
    if (!prev) return
    const next: StatementDraft = { ...prev, updatedAt: new Date().toISOString() }
    delete next.committedAt
    delete next.createdTxIds
    put(next)
  },

  remove: (id) => {
    get().load()
    const drafts = get().drafts.filter(d => d.id !== id)
    write(drafts)
    set({ drafts })
    const at = new Date().toISOString()
    writeDeleted([...readDeleted().filter(t => t.id !== id), { id, at }])
    schedule({ kind: 'delete', id, at })
  },
}
})
