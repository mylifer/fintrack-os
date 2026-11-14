/* ── Çalışma alanı yazma yetkisi (migration 0028) ─────────────────────────
   SAF modül — store/DB/Supabase bilmez, birim testli. Paylaşılan bir alanda
   "viewer" (salt okuma) üyesi okur ama yazamaz. Asıl kilit sunucudadır
   (0028'in RESTRICTIVE politikaları); istemci aynı kuralı yerel yazma
   katmanında (sync/engine.ts — localUpsert/localPatch/localBatch…) tek yerden
   uygular ki reddedilecek yazma outbox'a hiç girmesin. */

export type MemberRole = 'owner' | 'editor' | 'viewer'

/** Davette / rol değişiminde seçilebilen roller (sahiplik devredilmez). */
export type AssignableRole = Exclude<MemberRole, 'owner'>

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Sahip',
  editor: 'Düzenleyebilir',
  viewer: 'Salt okuma',
}

export function canWrite(role: MemberRole | null | undefined): boolean {
  // Üyelik yoksa (kendi kişisel alanım ya da paylaşılmamış alan) yazma serbest;
  // bilinmeyen bir rol (ileride eklenecek) temkinle salt okuma sayılır.
  if (role == null) return true
  return role === 'owner' || role === 'editor'
}

/** Üyeliklerden yazamadığım alanlar. */
export function readOnlyWorkspaceIdsOf(mine: ReadonlyArray<{ workspace_id: string; role: string }>): string[] {
  return [...new Set(mine.filter(m => !canWrite(m.role as MemberRole)).map(m => m.workspace_id))].sort()
}

/**
 * Bir yazmanın dokunduğu alanlardan (yeni satırın alanı, var olan satırın
 * önceki alanı, taşımada hedef alan) ilk salt okuma olanı; yazma serbestse
 * null. workspaceId'siz (eski) satır varsayılan alana — yani kullanıcının
 * kendi alanına — aittir; varsayılan alan paylaşılamadığı için kilitlenmez.
 */
export function blockedWorkspace(
  touched: ReadonlyArray<string | null | undefined>,
  readOnly: ReadonlyArray<string>,
): string | null {
  if (readOnly.length === 0) return null
  for (const id of touched) {
    if (id && readOnly.includes(id)) return id
  }
  return null
}

export const READ_ONLY_MESSAGE =
  'Bu çalışma alanı sizinle salt okuma olarak paylaşılıyor — değişiklik kaydedilmedi. ' +
  'Düzenlemek için alanın sahibinden düzenleme yetkisi isteyin.'

/** Yerel yazma katmanının fırlattığı hata — çağıran yakalamasa da hata
 *  kaydına (error_logs) düşmez (bkz. error-reporter.ts). */
export class ReadOnlyWorkspaceError extends Error {
  readonly workspaceId: string
  constructor(workspaceId: string) {
    super(READ_ONLY_MESSAGE)
    this.name = 'ReadOnlyWorkspaceError'
    this.workspaceId = workspaceId
  }
}

export function isReadOnlyWorkspaceError(err: unknown): err is ReadOnlyWorkspaceError {
  return err instanceof Error && err.name === 'ReadOnlyWorkspaceError'
}
