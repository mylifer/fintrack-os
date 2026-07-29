/* ── Çalışma alanı bağlamı ────────────────────────────────────────────────
   Bellek-içi tekil (singleton) + localStorage kalıcılığı. Kasıtlı olarak
   store/engine katmanlarından hiçbir şey import ETMEZ (lib/auth.ts'in
   getUserId() rolüne benzer bir yaprak modül): sync engine hem bunu okuyup
   (yeni kayıtları damgalamak için) hem de workspace.store.ts bu modülü VE
   engine'i birlikte kullanır — engine bu modülü import ederse ve bu modül de
   engine'i import etseydi döngüsel bağımlılık oluşurdu.

   Hesap değişimi/çıkış senaryosunda ek temizlik kodu GEREKMİYOR:
   lib/auth.ts'teki clearLocalData() zaten tema hariç tüm localStorage'ı
   siliyor, bu modülün anahtarı da otomatik silinir. */

const ACTIVE_KEY = 'fintrack.activeWorkspaceId'

let activeWorkspaceId: string | null = null
let defaultWorkspaceId: string | null = null

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = id
  if (typeof window === 'undefined') return
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch { /* storage kapalı */ }
}

export function getPersistedActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function getDefaultWorkspaceId(): string | null {
  return defaultWorkspaceId
}

export function setDefaultWorkspaceId(id: string | null): void {
  defaultWorkspaceId = id
}

/** Bir satırın VERİLEN çalışma alanına ait olup olmadığını söyler. workspaceId
 *  taşımayan (legacy) satırlar varsayılan çalışma alanına ait sayılır. */
export function rowInWorkspace(row: { workspaceId?: string | null }, workspaceId: string | null): boolean {
  const owner = row.workspaceId ?? defaultWorkspaceId
  return owner === workspaceId
}

/** Bir satırın AKTİF çalışma alanına ait olup olmadığını söyler. */
export function rowInActiveWorkspace(row: { workspaceId?: string | null }): boolean {
  return rowInWorkspace(row, activeWorkspaceId)
}
