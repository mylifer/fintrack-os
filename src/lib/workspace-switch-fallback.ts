import { rowInWorkspace } from '@/lib/workspace-context'
import { foldText } from '@/lib/auto-category'

/* ── Çalışma alanı değişince detay sayfasının yönü ─────────────────────────
   /accounts/[id] gibi bir detay sayfasındayken alan değiştirilince o kayıt
   yeni alanda yoktur; sayfa 404'e düşerdi. Bunun yerine yeni alandaki
   karşılığına (aynı adlı kayıt), yoksa — hesaplarda — alandaki ilk aktif
   hesaba, o da yoksa liste sayfasına gidilir.

   Sayfanın bu kaydı hiç görmediği durumda (bozuk/eski bağlantı) null döner:
   sayfa eskisi gibi "bulunamadı" davranışını sürdürür. Kayıt AYNI alanda
   kaybolduysa (silindi) liste sayfasına gidilir. */

export interface SwitchFallbackEntity {
  id: string
  workspaceId?: string | null
}

export interface SwitchFallbackOptions<T extends SwitchFallbackEntity> {
  /** Sayfanın en son gördüğü kayıt (artık listede yok). */
  lastSeen: T | null
  activeWorkspaceId: string | null
  /** Aktif alandaki aday kayıtlar (arşivlenmemiş, uygun rolde…). */
  candidates: T[]
  listHref: string
  hrefFor: (e: T) => string
  /** Eşleştirme anahtarı (varsayılan: ad). */
  keyOf?: (e: T) => string | undefined
  /** Ad eşleşmesi yoksa tercih edilecek adaylar (ör. aynı hesap türü). */
  prefer?: (candidate: T, lastSeen: T) => boolean
  /** Ad eşleşmesi yoksa listeye değil ilk adaya git. */
  pickFirst?: boolean
}

export function workspaceSwitchFallback<T extends SwitchFallbackEntity>(
  o: SwitchFallbackOptions<T>,
): string | null {
  const { lastSeen } = o
  if (!lastSeen) return null
  // Kayıt hâlâ aktif alana ait ama listede yok → silindi; listeye dön.
  if (rowInWorkspace(lastSeen, o.activeWorkspaceId)) return o.listHref

  const keyOf = o.keyOf ?? ((e: T) => (e as { name?: string }).name)
  const key = keyOf(lastSeen)
  if (key) {
    const k = foldText(key)
    const same = o.candidates.find(c => { const ck = keyOf(c); return !!ck && foldText(ck) === k })
    if (same) return o.hrefFor(same)
  }
  if (o.pickFirst) {
    const preferred = o.prefer ? o.candidates.find(c => o.prefer!(c, lastSeen)) : undefined
    const first = preferred ?? o.candidates[0]
    if (first) return o.hrefFor(first)
  }
  return o.listHref
}
