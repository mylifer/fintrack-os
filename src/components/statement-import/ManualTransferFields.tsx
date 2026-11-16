'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccountStore, useDebtStore, useWorkspaceStore } from '@/store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AppSelect } from '@/components/transactions/form/fields'
import { cn } from '@/lib/utils'
import type { Account, Debt } from '@/types'
import type { CrossWsTarget, DraftTx, TransferMode } from '@/lib/statement-import/classify'
import type { RowEdit } from '@/lib/statement-import/commit'

/* ── Ekstre satırında transferin karşı tarafı ────────────────────────────────
   İşlem Ekle formundaki transfer "Hedef" alanının ekstre karşılığı (bkz.
   TransferTargetField): giden parada hesap / bu alandaki borç / başka çalışma
   alanı (hesaba yatır ya da o alandaki borcu öde); gelen parada kaynak hesap.

   Sınıflandırıcının önerdiği transferde (ör. "Kart ödemesi: X") hedef hesap
   değiştirilebilir; Borç / Diğer Alan seçilince karar elle transfere geçer
   (onUseManual). Diğer alanın hesap ve borçları bellekte değil, ham Dexie'den
   okunur (useCrossWorkspaceTransfer ile aynı). Ekstre TL olduğundan hedef
   alanda yalnız TL hesaplar listelenir (kayıt kur dönüşümü yapmaz). */

interface Props {
  draft: DraftTx
  edit: RowEdit | undefined
  /** Ekstrenin yüklendiği hesap (listeden çıkarılır) */
  accountId: string
  /** Para hesaptan çıkıyor mu (hedef seçilir) yoksa giriyor mu (kaynak seçilir) */
  outgoing: boolean
  onEdit: (patch: RowEdit) => void
  /** Kararı elle transfere çevir (Borç / Diğer Alan sınıflandırıcı önerisinde yok) */
  onUseManual: () => void
}

const MODES: { key: TransferMode; label: string }[] = [
  { key: 'account', label: 'Hesap' },
  { key: 'debt', label: 'Borç' },
  { key: 'workspace', label: 'Diğer Alan' },
]

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded border border-input overflow-hidden text-[11px]" role="tablist" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}
          className={cn('px-2 py-0.5 transition-colors', i > 0 && 'border-l border-input',
            value === o.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">{children}</div>
}

/** Gelen transferin kaynak hesabı (İşlem Ekle'deki "Hesap" alanının yerinde) */
export function TransferSourceSelect({ draft, edit, accountId, onEdit, onOpenChange }: Pick<Props, 'draft' | 'edit' | 'accountId' | 'onEdit'> & { onOpenChange?: (o: boolean) => void }) {
  const accounts = useAccountStore(s => s.accounts)
  const options = useMemo(
    () => accounts.filter(a => !a.isArchived && a.id !== accountId).map(a => ({ value: a.id, label: a.name, icon: <AccountAvatar account={a} size="xs" /> })),
    [accounts, accountId],
  )
  return (
    <AppSelect
      value={edit?.fromAccountId ?? draft.fromAccountId ?? ''}
      onChange={v => onEdit({ fromAccountId: v || undefined })}
      options={options}
      placeholder="Paranın geldiği hesap…"
      error={!(edit?.fromAccountId ?? draft.fromAccountId)}
      onOpenChange={onOpenChange}
    />
  )
}

export function TransferTargetFields({ draft, edit, accountId, outgoing, onEdit, onUseManual, onOpenChange }: Props & { onOpenChange?: (o: boolean) => void }) {
  const accounts    = useAccountStore(s => s.accounts)
  const debts       = useDebtStore(s => s.debts)
  const workspaces  = useWorkspaceStore(s => s.workspaces)
  const activeWsId  = useWorkspaceStore(s => s.activeId)

  const ownAccounts = useMemo(
    () => accounts.filter(a => !a.isArchived && a.id !== accountId).map(a => ({ value: a.id, label: a.name, icon: <AccountAvatar account={a} size="xs" /> })),
    [accounts, accountId],
  )
  const ownDebts = useMemo(
    () => debts.filter(d => !d.deleted_at && d.direction === 'owe' && !d.isSettled).map(d => ({ value: d.id, label: d.name })),
    [debts],
  )
  const otherWs = useMemo(() => workspaces.filter(w => w.id !== activeWsId), [workspaces, activeWsId])

  const mode: TransferMode = draft.manual ? (edit?.transferMode ?? draft.transferMode ?? 'account') : 'account'
  const ws: CrossWsTarget | undefined = edit?.crossWs

  // Seçilen diğer alanın hesap ve borçları (ham Dexie)
  const [wsData, setWsData] = useState<{ wsId: string; accounts: Account[]; debts: Debt[] } | null>(null)
  useEffect(() => {
    if (mode !== 'workspace' || !ws?.workspaceId) return
    let cancelled = false
    const wsId = ws.workspaceId
    Promise.all([db.accounts.toArray(), db.debts.toArray()]).then(([accRows, debtRows]) => {
      if (cancelled) return
      setWsData({
        wsId,
        accounts: (accRows.filter(isLive) as Account[]).filter(a => rowInWorkspace(a, wsId) && !a.isArchived && a.currency === 'TRY'),
        debts: (debtRows.filter(isLive) as Debt[]).filter(d => rowInWorkspace(d, wsId) && d.direction === 'owe' && !d.isSettled),
      })
    })
    return () => { cancelled = true }
  }, [mode, ws?.workspaceId])
  const wsAccounts = wsData && wsData.wsId === ws?.workspaceId ? wsData.accounts : []
  const wsDebts    = wsData && wsData.wsId === ws?.workspaceId ? wsData.debts : []

  const setWs = (patch: Partial<CrossWsTarget>) => onEdit({ crossWs: { workspaceId: ws?.workspaceId ?? '', ...ws, ...patch } })
  // Açıklama elle değiştirilmediyse borcun adını izler (İşlem Ekle ile aynı)
  const describe = (name: string) => (edit?.description === undefined || edit.description === draft.description ? { description: `${name} ödemesi` } : {})

  function pickMode(m: TransferMode) {
    if (m === mode) return
    if (!draft.manual) onUseManual()
    onEdit({ transferMode: m })
  }

  if (!outgoing) return null
  const toAccount = edit?.toAccountId ?? draft.toAccountId ?? ''

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Hedef</span>
        <Segmented label="Hedef türü" value={mode} options={otherWs.length ? MODES : MODES.filter(m => m.key !== 'workspace')} onChange={pickMode} />
      </div>

      {mode === 'account' && (
        <AppSelect value={toAccount} onChange={v => onEdit({ toAccountId: v || undefined })}
          options={ownAccounts} placeholder="Seçin..." error={!toAccount} onOpenChange={onOpenChange} />
      )}

      {mode === 'debt' && (ownDebts.length === 0
        ? <Empty>Aktif borcunuz bulunmuyor</Empty>
        : <AppSelect value={edit?.debtId ?? ''} options={ownDebts} placeholder="Borç seçin..." error={!edit?.debtId} onOpenChange={onOpenChange}
            onChange={v => {
              const name = debts.find(d => d.id === v)?.name
              onEdit({ debtId: v || undefined, ...(name ? describe(name) : {}) })
            }} />
      )}

      {mode === 'workspace' && (
        <div className="flex flex-col gap-2">
          <AppSelect value={ws?.workspaceId ?? ''} placeholder="Çalışma alanı seçin..." error={!ws?.workspaceId} onOpenChange={onOpenChange}
            onChange={v => onEdit({ crossWs: { workspaceId: v, payDebt: ws?.payDebt } })}
            options={otherWs.map(w => ({ value: w.id, label: w.name }))} />
          {ws?.workspaceId && (
            <div className="self-start">
              <Segmented label="Diğer alanda" value={ws.payDebt ? 'debt' : 'account'}
                options={[{ key: 'account', label: 'Hesaba yatır' }, { key: 'debt', label: 'Borç öde' }]}
                onChange={v => setWs({ payDebt: v === 'debt', debtId: undefined })} />
            </div>
          )}
          {ws?.workspaceId && ws.payDebt && (wsDebts.length === 0
            ? <Empty>Bu alanda aktif borç bulunmuyor</Empty>
            : <AppSelect value={ws.debtId ?? ''} placeholder="Borç seçin..." error={!ws.debtId} onOpenChange={onOpenChange}
                options={wsDebts.map(d => ({ value: d.id, label: d.name }))}
                onChange={v => {
                  const debt = wsDebts.find(d => d.id === v)
                  // Borcun kendi ödeme hesabı o alanda TL hesapsa ara hesap olarak öner
                  const via = debt?.accountId && wsAccounts.some(a => a.id === debt.accountId) ? debt.accountId : ws.accountId
                  setWs({ debtId: debt?.id, accountId: via })
                  if (debt) { const p = describe(debt.name); if (p.description) onEdit(p) }
                }} />
          )}
          {ws?.workspaceId && (wsAccounts.length === 0
            ? <Empty>Bu alanda TL hesap bulunamadı</Empty>
            : <AppSelect value={ws.accountId ?? ''} error={!ws.accountId} onOpenChange={onOpenChange}
                placeholder={ws.payDebt ? 'Ödemenin geçeceği hesap...' : 'Hedef hesap seçin...'}
                onChange={v => setWs({ accountId: v || undefined })}
                options={wsAccounts.map(a => ({ value: a.id, label: a.name }))} />
          )}
          {ws?.payDebt && (
            <p className="text-xs text-muted-foreground">
              Ödeme, hedef alandaki bu hesaptan geçer: para bu hesaba girer ve borca ödenir — hesabın bakiyesi değişmez.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
