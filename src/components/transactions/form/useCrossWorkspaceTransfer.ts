import { useState, useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '@/store'
import { crossWorkspacePeers, splitCrossWsPeers } from '@/store/transactions.store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import type { Account, Debt, Transaction } from '@/types'
import { isCrossWsOutgoingLeg, type Tab } from './form-model'

export function useCrossWorkspaceTransfer({
  isEdit, isPlannedEdit, editingTx, setTab,
}: {
  isEdit: boolean
  isPlannedEdit: boolean
  editingTx: Transaction | undefined
  setTab: (t: Tab) => void
}) {
  // ── Çalışma alanları arası transfer ─────────────────────────────────────
  // Yeni kayıtta: bkz. useTransactionStore.addCrossWorkspaceTransfer.
  // Düzenlemede: kayıtlı bir aynı-alan transferi başka alana çevrilebilir ya da
  // var olan alanlar arası transferin ÇIKIŞ bacağı (hedef alan + hesap ve varsa
  // ödenen borç ön dolu) düzenlenir — bkz. updateCrossWorkspaceTransfer. Giriş
  // bacağı eskisi gibi sıradan gelir olarak düzenlenir.
  const allWorkspaces    = useWorkspaceStore(s => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeId)
  const otherWorkspaces  = useMemo(
    () => allWorkspaces.filter(w => w.id !== activeWorkspaceId),
    [allWorkspaces, activeWorkspaceId],
  )

  // Düzenlenen satır var olan bir alanlar arası transferin çıkış bacağı mı?
  // (Karşı bacak kontrolü asenkron — aşağıdaki effect doğrular.)
  const linkedLeg = isEdit && !!editingTx && isCrossWsOutgoingLeg(editingTx)
  // Düzenlemede "Diğer Alan" seçeneği: taksitsiz, borçsuz sıradan transfer ya
  // da doğrulanmış çıkış bacağı.
  const editable = isEdit && !isPlannedEdit && !!editingTx
    && !editingTx.isInstallment && !editingTx.installGroupId && !editingTx.debtId
    && !editingTx.systemKind && !editingTx.refundOfId
    && (editingTx.type === 'transfer' || linkedLeg)

  const [crossWs, setCrossWs]                 = useState(linkedLeg)
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(linkedLeg ? editingTx?.peerWorkspaceId ?? '' : '')
  const [targetAccounts, setTargetAccounts]   = useState<Account[]>([])
  const [targetAccountId, setTargetAccountId] = useState('')
  // Hedef alandaki bir borcu öde: para hedef hesaba girer ve aynı hesaptan
  // seçilen borca ödeme olarak çıkar (bkz. addCrossWorkspaceTransfer).
  const [crossWsDebt, setCrossWsDebt]         = useState(false)
  const [targetDebts, setTargetDebts]         = useState<Debt[]>([])
  const [targetDebtId, setTargetDebtId]       = useState('')
  // Düzenlenen bacağın karşı bacakları doğrulandı mı (giriş + varsa borç
  // ödemesi)? Doğrulanınca true; kayıtta bağ koparma buna bakar.
  const [linkedEditable, setLinkedEditable]   = useState(false)
  // Düzenlenen transferin ödediği borç: bu ödeme borcu kapatmış olabilir —
  // kapanmış olsa da listede kalsın.
  const [editingDebtId, setEditingDebtId]     = useState('')

  useEffect(() => {
    if (!linkedLeg || !editingTx) return
    let cancelled = false
    crossWorkspacePeers(editingTx).then(peers => {
      if (cancelled) return
      const { incoming: peer, payment } = splitCrossWsPeers(peers)
      if (!peer) {
        // Yetim/bozuk bacak kümesi: eskisi gibi gider olarak düzenlenir.
        setCrossWs(false)
        setTargetWorkspaceId('')
        setTab('expense')
        return
      }
      setLinkedEditable(true)
      if (peer.workspaceId) setTargetWorkspaceId(peer.workspaceId)
      setTargetAccountId(peer.accountId)
      if (payment?.debtId) {
        setCrossWsDebt(true)
        setTargetDebtId(payment.debtId)
        setEditingDebtId(payment.debtId)
      }
    })
    return () => { cancelled = true }
    // Yalnız açılışta: modal her açılışta yeniden bağlanır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          .filter(d => rowInWorkspace(d, targetWorkspaceId) && d.direction === 'owe'
            && (!d.isSettled || d.id === editingDebtId)) as Debt[],
      )
    })
    return () => { cancelled = true }
  }, [crossWs, targetWorkspaceId, editingDebtId])

  return {
    otherWorkspaces,
    /** Düzenlemede "Diğer Alan" sunulabilir mi */
    editable,
    /** Düzenlenen satır doğrulanmış bir alanlar arası transfer çıkış bacağı */
    linkedEditable,
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
