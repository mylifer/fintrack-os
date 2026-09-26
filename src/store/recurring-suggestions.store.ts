'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* Tekrarlayan önerilerinden "Gizle" denenler (lib/utils/recurring-detect key'i).
   Cihaz başına tutulur; hesap kimliği içerdiği için çıkışta silinir
   (DEVICE_KEYS'te DEĞİL). */

interface RecurringSuggestionsState {
  dismissed: string[]
  dismiss: (key: string) => void
}

export const useRecurringSuggestionsStore = create<RecurringSuggestionsState>()(
  persist(
    set => ({
      dismissed: [],
      dismiss: key => set(s => ({ dismissed: s.dismissed.includes(key) ? s.dismissed : [...s.dismissed, key] })),
    }),
    { name: 'fintrack-recurring-dismissed' },
  ),
)
