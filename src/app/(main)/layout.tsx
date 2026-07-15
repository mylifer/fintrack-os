'use client'

import { Sidebar }      from '@/components/layout/Sidebar'
import { MobileNav }    from '@/components/layout/MobileNav'
import { QuickAddFAB }  from '@/components/layout/QuickAddFAB'
import { DataProvider } from '@/components/layout/DataProvider'
import { TransactionFormModal } from '@/components/transactions/TransactionFormModal'
import { RefundModal } from '@/components/transactions/RefundModal'
import { ReconcileBalanceModal } from '@/components/accounts/ReconcileBalanceModal'
import { UndoToaster } from '@/components/layout/UndoToaster'
import { useUIStore } from '@/store'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  // Atomic selectors — avoid re-rendering the layout on unrelated UI changes
  // (period/filter/sidebar). Each modal is conditionally mounted and keyed by
  // its target so every open is a fresh instance (state resets for free).
  const modal        = useUIStore(s => s.modal)
  const modalPayload = useUIStore(s => s.modalPayload)

  return (
    <DataProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
          {children}
        </div>
        <MobileNav />
        <QuickAddFAB />
        {(modal === 'add-transaction' || modal === 'edit-transaction'
          || modal === 'add-recurring' || modal === 'edit-recurring') && (
          <TransactionFormModal key={`${modal}-${modalPayload?.id ?? 'new'}`} />
        )}
        {modal === 'refund-transaction' && (
          <RefundModal key={modalPayload?.id ?? 'new'} />
        )}
        {modal === 'reconcile-balance' && (
          <ReconcileBalanceModal key={modalPayload?.id ?? 'new'} />
        )}
        <UndoToaster />
      </div>
    </DataProvider>
  )
}
