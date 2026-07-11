'use client'

import { useState } from 'react'
import { useUIStore, useTransactionStore } from '@/store'
import { Button } from '@/components/ui/button'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { formatCurrency, parseCurrencyInput } from '@/lib/utils/currency'
import { today } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import { dedupeTags } from '@/lib/utils/tags'
import { X } from 'lucide-react'
import type { Transaction } from '@/types'

// Tag automatically appended to every refund so they can be filtered/summed apart.
const REFUND_TAG = '#İade'

type RefundMode = 'full' | 'partial'

/**
 * RefundModal — "İade İşle"
 *
 * Negative-Expense architecture: a refund never mutates the original expense.
 * It creates a NEW `expense` transaction whose amount is negative, so every
 * sum-based aggregate (account balance, category totals, reports) nets the
 * refund against the original spend without inflating income or gross expense.
 */
export function RefundModal() {
  const modal        = useUIStore(s => s.modal)
  const modalPayload = useUIStore(s => s.modalPayload)
  const closeModal   = useUIStore(s => s.closeModal)
  const transactions = useTransactionStore(s => s.transactions)
  const addTx        = useTransactionStore(s => s.add)

  const open = modal === 'refund-transaction'
  const original: Transaction | undefined = open && modalPayload?.id
    ? transactions.find(t => t.id === modalPayload.id)
    : undefined

  // Fresh instance per open (keyed remount in layout) → seed state directly,
  // no reset-on-open effect needed.
  const [mode, setMode]         = useState<RefundMode>('full')
  const [amountStr, setAmountStr] = useState('')
  const [dateStr, setDateStr]   = useState(today())
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const originalAmount = original ? Math.abs(original.amount) : 0

  if (!original) return null

  // Cumulative-refund guard (S4): sum prior refunds against THIS original so
  // the total can never exceed the original spend (which would net to phantom
  // income). "Full" refunds only what's still refundable.
  const alreadyRefunded = transactions
    .filter(t => t.refundOfId === original.id)
    .reduce((s, t) => s + Math.abs(t.amount), 0)
  const remaining = Math.max(0, Math.round((originalAmount - alreadyRefunded) * 100) / 100)
  const refundAmount = mode === 'full' ? remaining : parseCurrencyInput(amountStr)

  function validate(): boolean {
    if (remaining <= 0) {
      setError('Bu işlem zaten tamamen iade edilmiş')
      return false
    }
    if (mode === 'partial') {
      if (!refundAmount || refundAmount <= 0) {
        setError('Geçerli bir tutar girin')
        return false
      }
      if (refundAmount > remaining) {
        setError('İade tutarı kalan iade edilebilir tutarı aşamaz')
        return false
      }
    }
    setError('')
    return true
  }

  async function handleConfirm() {
    if (loading || !original || !validate()) return
    setLoading(true)
    try {
      const now = new Date().toISOString()
      const tags = dedupeTags([...(original.tags ?? []), REFUND_TAG])

      await addTx({
        id:             crypto.randomUUID(),
        type:           'expense',
        amount:         -Math.abs(refundAmount),   // negative expense → nets the original spend
        currency:       original.currency,
        date:           dateStr || today(),        // user-chosen refund date (period control, S4)
        accountId:      original.accountId,
        categoryId:     original.categoryId,
        merchant:       original.merchant,
        description:    `[İade] ${original.description}`,
        refundOfId:     original.id,               // link → original (cumulative guard, S4)
        tags,
        familyMemberId: original.familyMemberId ?? null,
        recipientId:    original.recipientId ?? null,
        isInstallment:  false,
        createdAt:      now,
        updatedAt:      now,
      })
      closeModal()
    } catch (err) {
      console.error('[refund:submit]', err)
      setError('İade kaydedilemedi, tekrar deneyin')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && closeModal()}>
      <DialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden" showCloseButton={false}>

        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle>İade İşle</DialogTitle>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {original.description} · {formatCurrency(originalAmount, original.currency)}
          </p>
        </DialogHeader>

        {/* Body */}
        <div className="flex flex-col gap-5 px-6 py-5">

          {/* Full / Partial choice — Bauhaus segmented control */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {([
              { key: 'full',    label: 'Tam İade'   },
              { key: 'partial', label: 'Kısmi İade' },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => { setMode(key); setError('') }}
                className={cn(
                  'rounded-md py-2 text-sm font-medium transition-all',
                  mode === key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Amount */}
          {mode === 'partial' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">İade Tutarı</label>
              <CurrencyInput
                currency={original.currency}
                value={amountStr}
                onChange={v => { setAmountStr(v); if (error) setError('') }}
                error={error || undefined}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Kalan iade edilebilir: {formatCurrency(remaining, original.currency)}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">İade Tutarı</span>
              <span className="text-xl font-bold tabular-nums text-green-600">
                +{formatCurrency(remaining, original.currency)}
              </span>
            </div>
          )}

          {/* İade tarihi — dönem ataması kullanıcı kontrolünde (S4) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">İade Tarihi</label>
            <input
              type="date"
              value={dateStr}
              onChange={e => { setDateStr(e.target.value); if (error) setError('') }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && mode === 'full' && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={closeModal} disabled={loading}>
            İptal
          </Button>
          <Button onClick={handleConfirm} loading={loading} disabled={loading}>
            İadeyi Onayla
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
