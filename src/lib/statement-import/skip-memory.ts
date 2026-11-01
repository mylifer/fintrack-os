/* "Girme" kararlarının hafızası (bu cihazda). Aynı ekstre tekrar yüklenirse
   kullanıcının girmemeyi seçtiği satırlar yeniden sorulmaz. localStorage
   erişilemezse (gizli pencere vb.) sessizce boş döner — karar yeniden sorulur,
   veri bozulmaz. */

const KEY = (accountId: string) => `fintrack:stmt-skip:${accountId}`
const LIMIT = 3000

export function loadSkipped(accountId: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY(accountId))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function rememberSkipped(accountId: string, keys: readonly string[]): void {
  if (!keys.length) return
  try {
    const all = [...loadSkipped(accountId), ...keys]
    localStorage.setItem(KEY(accountId), JSON.stringify([...new Set(all)].slice(-LIMIT)))
  } catch { /* hafıza yalnız kolaylık */ }
}

export function forgetSkipped(accountId: string, keys: readonly string[]): void {
  if (!keys.length) return
  try {
    const drop = new Set(keys)
    localStorage.setItem(KEY(accountId), JSON.stringify([...loadSkipped(accountId)].filter(k => !drop.has(k))))
  } catch { /* yok say */ }
}
