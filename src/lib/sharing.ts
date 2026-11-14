import { supabase } from '@/lib/supabase'
import type { AssignableRole, MemberRole } from '@/lib/workspace-permissions'

/* ── Çalışma alanı paylaşımı (migration 0021) ───────────────────────────────
   Sahip, varsayılan OLMAYAN bir alan için davet bağlantısı üretir; eşi kendi
   hesabıyla bağlantıyı açıp üye olur. Üyeler alanın tüm verisini görür;
   rol davette seçilir (0028): editor düzenler, viewer yalnız okur. Sahip rolü
   sonradan değiştirebilir. Varsayılan "Genel" alan paylaşılamaz.

   Sunucu hazır değilse (0021 uygulanmamış) üyelik sorgusu "tablo yok" hatası
   verir — `available: false` döner ve arayüz paylaşımı gizler; uygulamanın
   geri kalanı eskisi gibi çalışır. */

export type { MemberRole, AssignableRole }

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

/** Bu alan için oluşturduğum, henüz KULLANILMAMIŞ davetleri siler (RLS:
 *  yalnız created_by = ben). Böylece eski bağlantılar geçersiz olur. */
export async function revokePendingInvites(workspaceId: string): Promise<void> {
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
  if (error) throw friendly(error)
}

/** Davet bağlantısı (tek kullanımlık, 7 gün). Token yalnız bir kez döner.
 *  Önceki kullanılmamış bağlantılar iptal edilir — aynı anda tek geçerli
 *  davet bağlantısı olur. Rol (0028) davette saklanır; kabul eden o rolle
 *  katılır. 0028 uygulanmamış sunucuda iki argümanlı fonksiyon yoktur
 *  (PGRST202): editör daveti eski tek argümanlı fonksiyonla üretilir, salt
 *  okuma daveti ise ÜRETİLMEZ — sessizce editöre dönüşmesin. */
export async function createInviteLink(workspaceId: string, origin: string, role: AssignableRole = 'editor'): Promise<string> {
  await revokePendingInvites(workspaceId)
  let { data, error } = await supabase.rpc('create_workspace_invite', { p_workspace: workspaceId, p_role: role })
  if (error && isMissingFunction(error)) {
    if (role !== 'editor') throw new Error('Salt okuma daveti için sunucu tarafı hazır değil (0028 migration uygulanmamış).')
    ;({ data, error } = await supabase.rpc('create_workspace_invite', { p_workspace: workspaceId }))
  }
  if (error || typeof data !== 'string') throw friendly(error)
  return `${origin}/davet/${data}`
}

/** Sahip, üyenin rolünü değiştirir (editör ↔ salt okuma, 0028). */
export async function setMemberRole(workspaceId: string, userId: string, role: AssignableRole): Promise<void> {
  const { error } = await supabase.rpc('set_workspace_member_role', { p_workspace: workspaceId, p_user: userId, p_role: role })
  if (error && isMissingFunction(error)) throw new Error('Rol değiştirmek için sunucu tarafı hazır değil (0028 migration uygulanmamış).')
  if (error) throw friendly(error)
}

function isMissingFunction(err: { code?: string; message?: string }): boolean {
  return err.code === 'PGRST202' || /could not find the function/i.test(err.message ?? '')
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
  if (/geçersiz rol/.test(msg)) return new Error('Geçersiz rol.')
  if (/üye bulunamadı/.test(msg)) return new Error('Üye bulunamadı — listeyi yenileyin.')
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
