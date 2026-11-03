'use client'

import { create } from 'zustand'
import { deterministicUuid } from '@/lib/utils/id'
import type { ParsedStatement } from '@/lib/statement-import/statement'
import type { RowEdit } from '@/lib/statement-import/commit'

/* ── Yarım kalan ekstreler ───────────────────────────────────────────────────
   Yüklenip onaylanmayan ekstre kaybolmasın: ayrıştırılmış ekstre, seçilen
   hesap, verilen kararlar ve düzenlemeler her değişiklikte taslak olarak
   saklanır; onaylanınca silinir. Sayfa: /ekstre-yukle/taslaklar.

   Taslak yalnız BU cihazda (localStorage) durur — buluta gitmez, yeni tablo
   gerekmez. Çıkışta clearBrowserStorage tüm localStorage'ı sildiği için önceki
   kullanıcının taslakları cihazda kalmaz. Erişilemezse (gizli pencere) sessizce
   boş döner: ekstre yine yüklenir, yalnız yarım kalınca saklanmaz.

   Kimlik ekstreden türetilir (banka + kesim + kartlar + dönem borcu): aynı
   ekstre yeniden yüklenirse yeni taslak açılmaz, eskisinin kararları geri gelir. */

const KEY = 'fintrack:stmt-drafts'
const VERSION = 1
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
  choices: Record<string, number>
  edits: Record<string, RowEdit>
  progress: DraftProgress
  createdAt: string
  updatedAt: string
}

export function draftIdFor(st: ParsedStatement): string {
  return deterministicUuid(`stmt-draft:${st.bank}:${st.statementDate}:${st.account?.iban ?? st.cards.join(',')}:${st.summary?.debt ?? st.check.expected}`)
}

function read(): StatementDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) as { v?: number; drafts?: unknown } : null
    if (!parsed || parsed.v !== VERSION || !Array.isArray(parsed.drafts)) return []
    return (parsed.drafts as StatementDraft[]).filter(d => d && typeof d.id === 'string' && d.statement && Array.isArray(d.statement.lines))
  } catch {
    return []
  }
}

function write(drafts: StatementDraft[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, drafts }))
  } catch { /* dolu ya da kapalı: taslak yalnız bu oturumda kalır */ }
}

interface DraftsState {
  drafts: StatementDraft[]
  loaded: boolean
  load: () => void
  get: (id: string) => StatementDraft | undefined
  save: (draft: Omit<StatementDraft, 'createdAt' | 'updatedAt'>) => void
  remove: (id: string) => void
}

export const useStatementDraftsStore = create<DraftsState>()((set, get) => ({
  drafts: [],
  loaded: false,

  load: () => {
    if (get().loaded) return
    set({ drafts: read(), loaded: true })
  },

  get: (id) => {
    get().load()
    return get().drafts.find(d => d.id === id)
  },

  save: (draft) => {
    get().load()
    const now = new Date().toISOString()
    const prev = get().drafts.find(d => d.id === draft.id)
    const next: StatementDraft = { ...draft, createdAt: prev?.createdAt ?? now, updatedAt: now }
    const drafts = [next, ...get().drafts.filter(d => d.id !== draft.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, LIMIT)
    write(drafts)
    set({ drafts })
  },

  remove: (id) => {
    get().load()
    const drafts = get().drafts.filter(d => d.id !== id)
    write(drafts)
    set({ drafts })
  },
}))
