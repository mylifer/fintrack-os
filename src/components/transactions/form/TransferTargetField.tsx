'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Debt } from '@/types'
import { AppSelect } from './fields'
import type { TxForm } from './form-model'
import type { CrossWorkspaceTransfer } from './useCrossWorkspaceTransfer'

// Transfer sekmesinin "Hedef" alanı: hesap, borç ödemesi ya da (yeni kayıtta)
// başka bir çalışma alanı. Tekrarlayan şablonun hedefi bu alanı kullanmaz.
export function TransferTargetField({
  form, patch, errors, isEdit, sessionEditId, activeDebts, accountOptions, onSelectOpen, crossWorkspace,
}: {
  form: TxForm
  patch: (p: Partial<TxForm>) => void
  errors: Record<string, string>
  isEdit: boolean
  sessionEditId: string | null
  activeDebts: Debt[]
  accountOptions: { value: string; label: string; icon?: ReactNode }[]
  onSelectOpen: (open: boolean) => void
  crossWorkspace: CrossWorkspaceTransfer
}) {
  const {
    otherWorkspaces, crossWs, setCrossWs, targetWorkspaceId, setTargetWorkspaceId,
    targetAccounts, setTargetAccounts, targetAccountId, setTargetAccountId,
    crossWsDebt, setCrossWsDebt, targetDebts, setTargetDebts, targetDebtId, setTargetDebtId,
  } = crossWorkspace

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className={cn("text-sm font-medium", (errors.toAccountId || errors.debtId || errors.targetWorkspaceId) && "text-destructive")}>
          Hedef
        </span>
        <div className="flex rounded border border-input overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => { setCrossWs(false); patch({ isDebtPayment: false, debtId: undefined }) }}
            className={cn(
              "px-2 py-0.5 transition-colors",
              !form.isDebtPayment && !crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Hesap
          </button>
          {/* Oturum satırı düzenlenirken hedef yalnızca hesap olabilir:
              satır sıradan bir transfer olarak doğdu, borç/alan-transferi
              mutabakatı bu dalda yürütülmez. */}
          {!sessionEditId && (
            <button
              type="button"
              onClick={() => { setCrossWs(false); patch({ isDebtPayment: true, toAccountId: undefined }) }}
              className={cn(
                "px-2 py-0.5 transition-colors border-l border-input",
                form.isDebtPayment && !crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Borç
            </button>
          )}
          {!isEdit && !sessionEditId && otherWorkspaces.length > 0 && (
            <button
              type="button"
              onClick={() => { setCrossWs(true); patch({ isDebtPayment: false, toAccountId: undefined }) }}
              className={cn(
                "px-2 py-0.5 transition-colors border-l border-input",
                crossWs ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Diğer Alan
            </button>
          )}
        </div>
      </div>
      {crossWs ? (
        <div className="flex flex-col gap-2">
          <AppSelect
            value={targetWorkspaceId}
            onChange={v => {
              setTargetWorkspaceId(v); setTargetAccountId(''); setTargetAccounts([])
              setTargetDebtId(''); setTargetDebts([])
            }}
            options={otherWorkspaces.map(w => ({ value: w.id, label: w.name }))}
            placeholder="Çalışma alanı seçin..."
            error={!!errors.targetWorkspaceId}
            onOpenChange={onSelectOpen}
          />
          {errors.targetWorkspaceId && <p className="text-xs text-destructive">{errors.targetWorkspaceId}</p>}
          {targetWorkspaceId && (
            <div className="flex self-start rounded border border-input overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => { setCrossWsDebt(false); setTargetDebtId('') }}
                className={cn(
                  "px-2 py-0.5 transition-colors",
                  !crossWsDebt ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Hesaba yatır
              </button>
              <button
                type="button"
                onClick={() => setCrossWsDebt(true)}
                className={cn(
                  "px-2 py-0.5 transition-colors border-l border-input",
                  crossWsDebt ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Borç öde
              </button>
            </div>
          )}
          {targetWorkspaceId && crossWsDebt && (
            targetDebts.length === 0 ? (
              <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                Bu alanda aktif borç bulunmuyor
              </div>
            ) : (
              <AppSelect
                value={targetDebtId}
                onChange={v => {
                  setTargetDebtId(v)
                  const debt = targetDebts.find(d => d.id === v)
                  // Borcun kendi ödeme hesabı bu alandaysa ara hesap olarak öner
                  if (debt?.accountId && targetAccounts.some(a => a.id === debt.accountId)) {
                    setTargetAccountId(debt.accountId)
                  }
                  if (debt && !form.description.trim()) patch({ description: `${debt.name} ödemesi` })
                }}
                options={targetDebts.map(d => ({ value: d.id, label: d.name }))}
                placeholder="Borç seçin..."
                error={!!errors.debtId}
                onOpenChange={onSelectOpen}
              />
            )
          )}
          {crossWsDebt && errors.debtId && <p className="text-xs text-destructive">{errors.debtId}</p>}
          {targetWorkspaceId && crossWsDebt && targetDebts.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Ödeme, hedef alandaki aşağıdaki hesaptan geçer: para bu hesaba girer ve borca ödenir — hesabın bakiyesi değişmez.
            </p>
          )}
          {targetWorkspaceId && (
            targetAccounts.length === 0 ? (
              <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
                Bu alanda hesap bulunamadı
              </div>
            ) : (
              <AppSelect
                value={targetAccountId}
                onChange={setTargetAccountId}
                options={targetAccounts.map(a => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
                placeholder={crossWsDebt ? "Ödemenin geçeceği hesap..." : "Hedef hesap seçin..."}
                error={!!errors.toAccountId}
                onOpenChange={onSelectOpen}
              />
            )
          )}
          {errors.toAccountId && <p className="text-xs text-destructive">{errors.toAccountId}</p>}
        </div>
      ) : form.isDebtPayment ? (
        <>
          {activeDebts.length === 0 ? (
            <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/50 text-sm text-muted-foreground select-none">
              Aktif borcunuz bulunmuyor
            </div>
          ) : (
            <AppSelect
              value={form.debtId ?? ''}
              onChange={v => {
                const debt = activeDebts.find(d => d.id === v)
                patch({ debtId: v, ...(debt && !form.description.trim() ? { description: debt.name } : {}) })
              }}
              options={activeDebts.map(d => ({ value: d.id, label: d.name }))}
              placeholder="Borç seçin..."
              error={!!errors.debtId}
              onOpenChange={onSelectOpen}
            />
          )}
          {errors.debtId && <p className="text-xs text-destructive">{errors.debtId}</p>}
        </>
      ) : (
        <>
          <AppSelect
            value={form.toAccountId ?? ''}
            onChange={v => patch({ toAccountId: v })}
            options={accountOptions.filter(a => a.value !== form.accountId)}
            placeholder="Seçin..."
            error={!!errors.toAccountId}
            onOpenChange={onSelectOpen}
          />
          {errors.toAccountId && <p className="text-xs text-destructive">{errors.toAccountId}</p>}
        </>
      )}
    </div>
  )
}
