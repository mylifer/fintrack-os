import { useState, useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '@/store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import type { Account, Debt } from '@/types'

export function useCrossWorkspaceTransfer() {
  // ── Çalışma alanları arası transfer ─────────────────────────────────────
  // Sadece YENİ (düzenlenmeyen, tekrarlamayan) transfer için — bkz.
  // useTransactionStore.addCrossWorkspaceTransfer. Karşı bacak sıradan bir
  // gider/gelir satırı olduğundan, mevcut bir bacağı düzenlerken bu blok hiç
  // görünmez (o zaman tab 'expense'/'income'dir, 'transfer' değil).
  const allWorkspaces    = useWorkspaceStore(s => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeId)
  const otherWorkspaces  = useMemo(
    () => allWorkspaces.filter(w => w.id !== activeWorkspaceId),
    [allWorkspaces, activeWorkspaceId],
  )
  const [crossWs, setCrossWs]                 = useState(false)
  const [targetWorkspaceId, setTargetWorkspaceId] = useState('')
  const [targetAccounts, setTargetAccounts]   = useState<Account[]>([])
  const [targetAccountId, setTargetAccountId] = useState('')
  // Hedef alandaki bir borcu öde: para hedef hesaba girer ve aynı hesaptan
  // seçilen borca ödeme olarak çıkar (bkz. addCrossWorkspaceTransfer).
  const [crossWsDebt, setCrossWsDebt]         = useState(false)
  const [targetDebts, setTargetDebts]         = useState<Debt[]>([])
  const [targetDebtId, setTargetDebtId]       = useState('')

  useEffect(() => {
    // Boş hedef alan durumunda state'e dokunulmaz — hesap picker'ı zaten
    // `targetWorkspaceId` yokken render edilmiyor (aşağıda). Sıfırlama, alanı
    // DEĞİŞTİREN event handler'da yapılır (bkz. AppSelect onChange), effect
    // içinde senkron setState'ten kaçınmak için.
    if (!crossWs || !targetWorkspaceId) return
    let cancelled = false
    Promise.all([db.accounts.toArray(), db.debts.toArray()]).then(([accRows, debtRows]) => {
      if (cancelled) return
      setTargetAccounts(
        accRows.filter(isLive).filter(a => rowInWorkspace(a, targetWorkspaceId)) as Account[],
      )
      // Yalnız ödenecek yöndeki (benim borcum) ve kapanmamış borçlar
      setTargetDebts(
        debtRows.filter(isLive)
          .filter(d => rowInWorkspace(d, targetWorkspaceId) && d.direction === 'owe' && !d.isSettled) as Debt[],
      )
    })
    return () => { cancelled = true }
  }, [crossWs, targetWorkspaceId])

  return {
    otherWorkspaces,
    crossWs, setCrossWs,
    targetWorkspaceId, setTargetWorkspaceId,
    targetAccounts, setTargetAccounts,
    targetAccountId, setTargetAccountId,
    crossWsDebt, setCrossWsDebt,
    targetDebts, setTargetDebts,
    targetDebtId, setTargetDebtId,
  }
}

export type CrossWorkspaceTransfer = ReturnType<typeof useCrossWorkspaceTransfer>
