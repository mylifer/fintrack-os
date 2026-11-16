'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkspaceStore } from '@/store'
import {
  workspaceSwitchFallback,
  type SwitchFallbackEntity,
  type SwitchFallbackOptions,
} from '@/lib/workspace-switch-fallback'

/** Detay sayfasının kaydı (alan değişimi ya da silme yüzünden) listeden
 *  düştüğünde uygun sayfaya yönlendirir — bkz. workspace-switch-fallback.ts.
 *  `true` dönerse yönlendirme sürüyordur: sayfa hiçbir şey çizmemeli
 *  (404/"bulunamadı" yanıp sönmesin). */
export function useWorkspaceSwitchFallback<T extends SwitchFallbackEntity>(
  entity: T | undefined,
  ready: boolean,
  opts: Omit<SwitchFallbackOptions<T>, 'lastSeen' | 'activeWorkspaceId'>,
): boolean {
  const router = useRouter()
  const activeWorkspaceId = useWorkspaceStore(s => s.activeId)

  // Sayfanın gördüğü son kayıt. Render sırasında güncellenir (React'in
  // "önceki prop'a göre state ayarla" deseni) — kayıt düştüğü ilk render'da
  // hedef hemen hesaplanabilsin.
  const [lastSeen, setLastSeen] = useState<T | null>(null)
  if (entity && entity !== lastSeen) setLastSeen(entity)

  const target = !entity && ready
    ? workspaceSwitchFallback({ ...opts, lastSeen, activeWorkspaceId })
    : null

  useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])

  return target !== null
}
