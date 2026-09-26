import { supabase } from '@/lib/supabase'

/* ── Çalışma alanı paylaşımı (migration 0021) ───────────────────────────────
   Sahip, varsayılan OLMAYAN bir alan için davet bağlantısı üretir; eşi kendi
   hesabıyla bağlantıyı açıp üye olur. Üyeler alanın tüm verisini görür ve
   düzenler (rol: editor). Varsayılan "Genel" alan paylaşılamaz.

   Sunucu hazır değilse (0021 uygulanmamış) üyelik sorgusu "tablo yok" hatası
   verir — `available: false` döner ve arayüz paylaşımı gizler; uygulamanın
   geri kalanı eskisi gibi çalışır. */

export type MemberRole = 'owner' | 'editor'

export interface Membership {
  workspace_id: string
  user_id: string
  role: MemberRole
  email: string | null
  created_at: string
}

export interface MembershipState {
  /** Sunucu tarafı (0021) hazır mı */
  available: boolean
  /** Liste buluttan EKSİKSİZ okundu mu (çevrimdışı/hata → false) */
  complete: boolean
  mine: Membership[]
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? ''))
}

/** Kendi üyeliklerim (sahibi olduğum paylaşılan alanlar + üye olduklarım). */
export async function fetchMyMemberships(): Promise<MembershipState> {
  try {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) return { available: true, complete: false, mine: [] }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('workspace_id, user_id, role, email, created_at')
      .eq('user_id', userId)
    if (error) return { available: !isMissingTable(error), complete: false, mine: [] }
    return { available: true, complete: true, mine: (data ?? []) as Membership[] }
  } catch {
    return { available: true, complete: false, mine: [] }
  }
}

/** Sahip olmadığım ama üyesi olduğum alanlar. */
export function memberWorkspaceIdsOf(mine: Membership[]): string[] {
  return mine.filter(m => m.role !== 'owner').map(m => m.workspace_id)
}

export async function listMembers(workspaceId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role, email, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
  if (error) throw friendly(error)
  return (data ?? []) as Membership[]
}

/** Davet bağlantısı (tek kullanımlık, 7 gün). Token yalnız bir kez döner. */
export async function createInviteLink(workspaceId: string, origin: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_workspace_invite', { p_workspace: workspaceId })
  if (error || typeof data !== 'string') throw friendly(error)
  return `${origin}/davet/${data}`
}

/** Daveti kabul eder; katılınan alanın kimliğini döner. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_workspace_invite', { p_token: token })
  if (error || typeof data !== 'string') throw friendly(error)
  return data
}

/** Sahip üyeyi çıkarır ya da üye kendisi ayrılır. */
export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  const { error, count } = await supabase
    .from('workspace_members')
    .delete({ count: 'exact' })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
  if (error) throw friendly(error)
  if (count === 0) throw new Error('Üyelik bulunamadı ya da bu işlem için yetkiniz yok.')
}

export function friendly(err: { code?: string; message?: string } | null | undefined): Error {
  const msg = err?.message ?? ''
  if (isMissingTable(err ?? null) || err?.code === 'PGRST202') return new Error('Sunucu tarafı hazır değil (0021 migration uygulanmamış).')
  if (/geçersiz ya da süresi dolmuş/.test(msg)) return new Error('Davet geçersiz, kullanılmış ya da süresi dolmuş. Yeni bağlantı isteyin.')
  if (/kendi alanınıza/.test(msg)) return new Error('Bu davet sizin kendi alanınız için — eşinizle paylaşın.')
  if (/varsayılan alan/.test(msg)) return new Error('Varsayılan "Genel" alan paylaşılamaz. Aile için ayrı bir alan oluşturun.')
  if (/alan bulunamadı|yetki yok|42501|row-level security/i.test(msg) || err?.code === '42501') {
    return new Error('Bu işlem için yetkiniz yok. İki adımlı doğrulama açıksa kodla giriş yaptığınızdan emin olun.')
  }
  if (/failed to fetch|network/i.test(msg)) return new Error('Bağlantı yok — paylaşım için internet gerekli.')
  return new Error('İşlem tamamlanamadı, tekrar deneyin.')
}

/** Giriş sonrası dönülebilecek güvenli adres: yalnız davet sayfası (açık yönlendirme yok). */
export function safeInviteNext(next: string | null | undefined): string | null {
  return next && /^\/davet\/[0-9a-f]{64}$/.test(next) ? next : null
}
