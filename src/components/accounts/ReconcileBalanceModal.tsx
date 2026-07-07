'use client'

import { useEffect, useMemo, useState } from 'react'
import { useUIStore, useAccountStore, useTransactionStore } from '@/store'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { RECONCILE_TAG, RECONCILE_DESCRIPTION } from '@/lib/utils/reconciliation'
import { X } from 'lucide-react'

/**
 * ReconcileBalanceModal — "Bakiye Eşitleme"
 *
 * Bridges the account's app-calculated balance to the user's real bank
 * balance WITHOUT touching `initialBalance` (which would destroy historical
 * Net Worth charts). It posts a single "ghost" transaction for the delta:
 *   Delta = Actual Balance − App Calculated Balance
 *   Delta > 0 → income,  Delta < 0 → expense,  amount = |Delta|
 * The ghost carries the canonical RECONCILE_TAG so every income/expense
 * analytic can filter it out — it exists strictly to correct the ledger.
 */
export function ReconcileBalanceModal() {
  const { modal, modalPayload, closeModal } = useUIStore()
  const accounts = useAccountStore(s => s.accounts)
  const addTx    = useTransactionStore(s => s.add)

  const open = modal === 'reconcile-balance'
  const account = open && modalPayload?.id
    ? accounts.find(a => a.id === modalPayload.id)
    : undefined

  const isCreditCard = account?.type === 'credit_card'

  const [actualStr, setActualStr] = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  // Reset whenever the dialog (re)opens for a (possibly different) account.
  useEffect(() => {
    if (open) { setActualStr(''); setError(''); setLoading(false) }
  }, [open, modalPayload?.id])

  // App-calculated balance in the app's signed convention (credit-card debt is
  // negative). Credit-card input is entered as a positive debt, mirroring the
  // AccountFormModal convention.
  const appBalance = account?.balance ?? 0
  const actualSigned = useMemo(() => {
    const parsed = parseCurrencyInput(actualStr)
    return isCreditCard ? -Math.abs(parsed) : parsed
  }, [actualStr, isCreditCard])

  const delta = useMemo(
    () => Math.round((actualSigned - appBalance) * 100) / 100,
    [actualSigned, appBalance],
  )
  const hasInput = actualStr.trim() !== ''

  if (!account) return null

  async function handleConfirm() {
    if (loading || !account) return
    if (!hasInput) { setError('Gerçek bakiyeyi girin'); return }
    if (delta === 0) { setError('Bakiye zaten güncel — düzeltme gerekmiyor'); return }

    setLoading(true)
    try {
      const now = new Date().toISOString()
      await addTx({
        id:             crypto.randomUUID(),
        type:           delta > 0 ? 'income' : 'expense',
        amount:         Math.abs(delta),        // amount is always positive; direction from type
        currency:       account.currency,
        date:           today(),
        accountId:      account.id,
        description:    RECONCILE_DESCRIPTION,
        tags:           [RECONCILE_TAG],         // canonical marker → excluded from analytics
        familyMemberId: null,
        recipientId:    null,
        isInstallment:  false,
        createdAt:      now,
        updatedAt:      now,
      })
      closeModal()
    } catch (err) {
      console.error('[reconcile:submit]', err)
      setError('Eşitleme kaydedilemedi, tekrar deneyin')
    } finally {
      setLoading(false)
    }
  }

  const currency  = account.currency
  const balLabel  = isCreditCard ? 'Uygulama Borcu' : 'Uygulama Bakiyesi'
  const inpLabel  = isCreditCard ? 'Gerçek Güncel Borç' : 'Gerçek Güncel Bakiye'

  return (
    <Dialog open={open} onOpenChange={v => !v && closeModal()}>
      <DialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden" showCloseButton={false}>

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle>Bakiye Eşitle</DialogTitle>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground truncate">{account.name}</p>
        </DialogHeader>

        {/* Body */}
        <div className="flex flex-col gap-5 px-6 py-5">

          {/* App-calculated balance (read-only reference) */}
          <div className="flex items-baseline justify-between rounded-lg bg-muted px-4 py-3">
            <span className="text-sm text-muted-foreground">{balLabel}</span>
            <span className={`text-sm font-semibold tabular-nums ${appBalance < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {appBalance < 0 ? '−' : ''}{formatCurrency(Math.abs(appBalance), currency)}
            </span>
          </div>

          {/* Actual balance input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{inpLabel}</label>
            <CurrencyInput
              currency={currency}
              value={actualStr}
              onChange={v => { setActualStr(v); if (error) setError('') }}
              error={error || undefined}
              autoFocus
            />
          </div>

          {/* Delta preview */}
          {hasInput && delta !== 0 && (
            <div className="rounded-lg border border-dashed p-4 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">
                {delta > 0 ? 'Eklenecek düzeltme (Gelir)' : 'Düşülecek düzeltme (Gider)'}
              </span>
              <span className={`text-xl font-bold tabular-nums ${delta > 0 ? 'text-green-600' : 'text-destructive'}`}>
                {delta > 0 ? '+' : '−'}{formatCurrency(Math.abs(delta), currency)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={closeModal} disabled={loading}>
            İptal
          </Button>
          <Button onClick={handleConfirm} loading={loading} disabled={loading}>
            Eşitle
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
