import type { ColumnMapping } from './column-map'

/* Elle yapılan sütun eşlemelerinin hafızası (bu cihazda; skip-memory.ts
   kalıbı). Anahtar ekstrenin başlık imzasıdır (tableSignature): aynı bankanın
   sonraki ekstresi aynı imzayı taşır, eşleme tek tıkla uygulanır. localStorage
   erişilemezse sessizce boş döner — eşleme yeniden sorulur, veri bozulmaz. */

const KEY = 'fintrack:stmt-colmap'
const LIMIT = 50

export interface RememberedMapping {
  mapping: ColumnMapping
  /** Kullanıcının verdiği ad ("Örnek Bank kartı") */
  label: string
  usedAt: string
}

type Store = Record<string, RememberedMapping>

function readAll(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

const isMapping = (m: unknown): m is ColumnMapping =>
  !!m && typeof m === 'object' && ['date', 'description', 'amount', 'debit', 'credit', 'balance'].every(k => typeof (m as Record<string, unknown>)[k] === 'number')

export function loadMapping(signature: string): RememberedMapping | null {
  const hit = readAll()[signature]
  return hit && isMapping(hit.mapping) ? hit : null
}

export function rememberMapping(signature: string, mapping: ColumnMapping, label: string, nowIso = new Date().toISOString()): void {
  try {
    const all = { ...readAll(), [signature]: { mapping, label, usedAt: nowIso } }
    const keep = Object.entries(all).sort((a, b) => (b[1].usedAt ?? '').localeCompare(a[1].usedAt ?? '')).slice(0, LIMIT)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)))
  } catch { /* hafıza yalnız kolaylık */ }
}

export function forgetMapping(signature: string): void {
  try {
    const all = readAll()
    delete all[signature]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* yok say */ }
}
