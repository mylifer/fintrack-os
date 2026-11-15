'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccountStore, useDebtStore, useWorkspaceStore } from '@/store'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { rowInWorkspace } from '@/lib/workspace-context'
import { SelectField } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import type { Account, Debt } from '@/types'
import type { CrossWsTarget, DraftTx, TransferMode } from '@/lib/statement-import/classify'
import type { RowEdit } from '@/lib/statement-import/commit'

/* ── Elle transferin hedefi ───────────────────────────────────────────────────
   İşlem Ekle formundaki transfer "Hedef" alanının ekstre karşılığı (bkz.
   TransferTargetField): giden parada hesap / bu alandaki borç / başka çalışma
   alanı (hesaba yatır ya da o alandaki borcu öde); gelen parada kaynak hesap.
   Diğer alanın hesap ve borçları bellekte değil, ham Dexie'den okunur
   (useCrossWorkspaceTransfer ile aynı). Ekstre TL olduğundan hedef alanda
   yalnız TL hesaplar listelenir (kayıt kur dönüşümü yapmaz). */

interface Props {
  draft: DraftTx
  edit: RowEdit | undefined
  /** Ekstrenin yüklendiği hesap (hedef listesinden çıkarılır) */
  accountId: string
  onEdit: (patch: RowEdit) => void
}

const MODES: { key: TransferMode; label: string }[] = [
  { key: 'account', label: 'Hesap' },
  { key: 'debt', label: 'Borç' },
  { key: 'workspace', label: 'Diğer Alan' },
]

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex self-start rounded-md border border-input overflow-hidden text-xs" role="tablist">
      {options.map((o, i) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}
          className={cn('px-2.5 py-1 transition-colors', i > 0 && 'border-l border-input',
            value === o.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ManualTransferFields({ draft, edit, accountId, onEdit }: Props) {
  const accounts    = useAccountStore(s => s.accounts)
  const debts       = useDebtStore(s => s.debts)
  const workspaces  = useWorkspaceStore(s => s.workspaces)
  const activeWsId  = useWorkspaceStore(s => s.activeId)

  const ownAccounts = useMemo(
    () => accounts.filter(a => !a.isArchived && a.id !== accountId).map(a => ({ value: a.id, label: a.name })),
    [accounts, accountId],
  )
  const ownDebts = useMemo(
    () => debts.filter(d => !d.deleted_at && d.direction === 'owe' && !d.isSettled).map(d => ({ value: d.id, label: d.name })),
    [debts],
  )
  const otherWs = useMemo(() => workspaces.filter(w => w.id !== activeWsId), [workspaces, activeWsId])

  const outgoing = !!draft.transferMode
  const mode: TransferMode = edit?.transferMode ?? draft.transferMode ?? 'account'
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

  if (!outgoing) {
    return (
      <SelectField
        label="Paranın geldiği hesap"
        value={edit?.fromAccountId ?? ''}
        onChange={e => onEdit({ fromAccountId: e.target.value || undefined })}
        options={[{ value: '', label: 'Hesap seçin…' }, ...ownAccounts]}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">Hedef</span>
        <Segmented value={mode} options={otherWs.length ? MODES : MODES.filter(m => m.key !== 'workspace')}
          onChange={m => onEdit({ transferMode: m })} />
      </div>

      {mode === 'account' && (
        <SelectField
          label="Paranın gittiği hesap"
          value={edit?.toAccountId ?? ''}
          onChange={e => onEdit({ toAccountId: e.target.value || undefined })}
          options={[{ value: '', label: 'Hesap seçin…' }, ...ownAccounts]}
        />
      )}

      {mode === 'debt' && (ownDebts.length === 0
        ? <div className="text-sm text-muted-foreground">Bu çalışma alanında ödenecek aktif borç yok.</div>
        : <SelectField
            label="Ödenecek borç"
            value={edit?.debtId ?? ''}
            onChange={e => {
              const id = e.target.value || undefined
              const name = debts.find(d => d.id === id)?.name
              onEdit({ debtId: id, ...(name && (edit?.description === undefined || edit.description === draft.description) ? { description: `${name} ödemesi` } : {}) })
            }}
            options={[{ value: '', label: 'Borç seçin…' }, ...ownDebts]}
          />
      )}

      {mode === 'workspace' && (
        <div className="flex flex-col gap-2">
          <SelectField
            label="Hedef çalışma alanı"
            value={ws?.workspaceId ?? ''}
            onChange={e => onEdit({ crossWs: { workspaceId: e.target.value, payDebt: ws?.payDebt } })}
            options={[{ value: '', label: 'Çalışma alanı seçin…' }, ...otherWs.map(w => ({ value: w.id, label: w.name }))]}
          />
          {ws?.workspaceId && (
            <Segmented value={ws.payDebt ? 'debt' : 'account'}
              options={[{ key: 'account', label: 'Hesaba yatır' }, { key: 'debt', label: 'Borç öde' }]}
              onChange={v => setWs({ payDebt: v === 'debt', debtId: undefined })} />
          )}
          {ws?.workspaceId && ws.payDebt && (wsDebts.length === 0
            ? <div className="text-sm text-muted-foreground">Bu alanda ödenecek aktif borç yok.</div>
            : <SelectField
                label="Ödenecek borç"
                value={ws.debtId ?? ''}
                onChange={e => {
                  const debt = wsDebts.find(d => d.id === e.target.value)
                  // Borcun kendi ödeme hesabı o alanda TL hesapsa ara hesap olarak öner
                  const via = debt?.accountId && wsAccounts.some(a => a.id === debt.accountId) ? debt.accountId : ws.accountId
                  setWs({ debtId: debt?.id, accountId: via })
                  if (debt && (edit?.description === undefined || edit.description === draft.description)) onEdit({ description: `${debt.name} ödemesi` })
                }}
                options={[{ value: '', label: 'Borç seçin…' }, ...wsDebts.map(d => ({ value: d.id, label: d.name }))]}
              />
          )}
          {ws?.workspaceId && (wsAccounts.length === 0
            ? <div className="text-sm text-muted-foreground">Bu alanda TL hesap yok.</div>
            : <SelectField
                label={ws.payDebt ? 'Ödemenin geçeceği hesap' : 'Paranın gittiği hesap'}
                value={ws.accountId ?? ''}
                onChange={e => setWs({ accountId: e.target.value || undefined })}
                options={[{ value: '', label: ws.payDebt ? 'Ödemenin geçeceği hesap…' : 'Hesap seçin…' }, ...wsAccounts.map(a => ({ value: a.id, label: a.name }))]}
              />
          )}
          {ws?.payDebt && (
            <span className="text-[11px] text-muted-foreground">
              Para hedef alandaki bu hesaba girer ve aynı hesaptan borca ödenir — o hesabın bakiyesi değişmez.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
