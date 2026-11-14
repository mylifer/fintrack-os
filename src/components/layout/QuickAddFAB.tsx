'use client'

import { useUIStore, useWorkspaceStore, selectActiveReadOnly } from '@/store'

export function QuickAddFAB() {
  const openModal = useUIStore(s => s.openModal)
  // Salt okuma alanında (0028) gizli — kilit yine engine'de
  const readOnly  = useWorkspaceStore(selectActiveReadOnly)
  if (readOnly) return null

  return (
    <button
      onClick={() => openModal('add-transaction')}
      className={[
        'lg:hidden print:hidden fixed bottom-20 right-5 z-50',
        'w-14 h-14 bg-primary text-white rounded-full',
        'flex items-center justify-center',
        'text-2xl',
        'shadow-[0_4px_20px_rgba(14,165,233,0.4)]',
        'active:scale-95 transition-transform',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      ].join(' ')}
      aria-label="İşlem ekle"
    >
      +
    </button>
  )
}
