import { useState, useEffect, useMemo } from 'react'
import { useWorkspaceStore } from '@/store'
import { crossWorkspacePeers, classifyCrossWsLegs } from '@/store/transactions.store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import type { Account, Debt, Transaction } from '@/types'
import { crossWsLegDirection, type Tab } from './form-model'

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
  // Düzenlemede (bkz. updateCrossWorkspaceTransfer):
  //   • kayıtlı bir aynı-alan transferi başka alana çevrilebilir;
  //   • ÇIKIŞ bacağı ('out'): karşı alan = hedef; alan, hesap ve varsa ödenen
  //     borç (hedef alanda) ön dolu açılır;
  //   • GİRİŞ bacağı ('in'): karşı alan = KAYNAK; formun "Hesap"ı paranın
  //     girdiği bu alandaki hesaptır, borç da bu alandan seçilir.
  // `targetWorkspaceId/targetAccountId/targetAccounts` her iki yönde de KARŞI
  // alanı/hesabı tutar; yönü `direction` söyler.
  const allWorkspaces    = useWorkspaceStore(s => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeId)
  const otherWorkspaces  = useMemo(
    () => allWorkspaces.filter(w => w.id !== activeWorkspaceId),
    [allWorkspaces, activeWorkspaceId],
  )

  // Düzenlenen satır var olan bir alanlar arası transferin bacağı mı?
  // (Karşı bacak kontrolü asenkron — aşağıdaki effect doğrular.)
  const legDirection = isEdit && editingTx ? crossWsLegDirection(editingTx) : null
  const direction: 'out' | 'in' = legDirection ?? 'out'
  // Düzenlemede "Diğer Alan" seçeneği: taksitsiz, borçsuz sıradan transfer ya
  // da alanlar arası transfer bacağı.
  const editable = isEdit && !isPlannedEdit && !!editingTx
    && !editingTx.isInstallment && !editingTx.installGroupId && !editingTx.debtId
    && !editingTx.systemKind && !editingTx.refundOfId
    && (editingTx.type === 'transfer' || !!legDirection)

  const [crossWs, setCrossWs]                 = useState(!!legDirection)
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(legDirection ? editingTx?.peerWorkspaceId ?? '' : '')
  const [targetAccounts, setTargetAccounts]   = useState<Account[]>([])
  const [targetAccountId, setTargetAccountId] = useState('')
  // Borç öde: para hedef hesaba girer ve aynı hesaptan seçilen borca ödeme
  // olarak çıkar (bkz. addCrossWorkspaceTransfer). Borç her zaman HEDEF
  // alandadır: 'out'ta karşı alan, 'in'de aktif alan.
  const [crossWsDebt, setCrossWsDebt]         = useState(false)
  const [targetDebts, setTargetDebts]         = useState<Debt[]>([])
  const [targetDebtId, setTargetDebtId]       = useState('')
  // Düzenlenen bacağın karşı bacakları doğrulandı mı? Doğrulanınca true;
  // kayıtta bağ koparma buna bakar.
  const [linkedEditable, setLinkedEditable]   = useState(false)
  // Düzenlenen transferin ödediği borç: bu ödeme borcu kapatmış olabilir —
  // kapanmış olsa da listede kalsın.
  const [editingDebtId, setEditingDebtId]     = useState('')

  useEffect(() => {
    if (!legDirection || !editingTx) return
    let cancelled = false
    crossWorkspacePeers(editingTx).then(peers => {
      if (cancelled) return
      const { outgoing, incoming, payment } = classifyCrossWsLegs([editingTx, ...peers])
      if (!outgoing || !incoming) {
        // Yetim/bozuk bacak kümesi: eskisi gibi gider/gelir olarak düzenlenir.
        setCrossWs(false)
        setTargetWorkspaceId('')
        setTab(editingTx.type as Tab)
        return
      }
      setLinkedEditable(true)
      const other = legDirection === 'out' ? incoming : outgoing
      if (other.workspaceId) setTargetWorkspaceId(other.workspaceId)
      setTargetAccountId(other.accountId)
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

  // Borçların okunduğu alan: hedef alan ('out' → karşı alan, 'in' → aktif alan)
  const debtWorkspaceId = direction === 'in' ? activeWorkspaceId : targetWorkspaceId

  useEffect(() => {
    // Boş karşı alan durumunda state'e dokunulmaz — hesap picker'ı zaten
    // `targetWorkspaceId` yokken render edilmiyor. Sıfırlama, alanı
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
          .filter(d => rowInWorkspace(d, debtWorkspaceId) && d.direction === 'owe'
            && (!d.isSettled || d.id === editingDebtId)) as Debt[],
      )
    })
    return () => { cancelled = true }
  }, [crossWs, targetWorkspaceId, debtWorkspaceId, editingDebtId])

  return {
    otherWorkspaces,
    /** Düzenlemede "Diğer Alan" sunulabilir mi */
    editable,
    /** 'out': karşı alan hedeftir; 'in': karşı alan kaynaktır (giriş bacağı düzenleniyor) */
    direction,
    /** Düzenlenen satır doğrulanmış bir alanlar arası transfer bacağı */
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
