import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { isReconciliation, RECONCILE_TAG } from './reconciliation'

describe('isReconciliation (S7)', () => {
  it('true via the first-class systemKind field', () => {
    expect(isReconciliation({ systemKind: 'reconciliation' } as Transaction)).toBe(true)
  })
  it('true via the legacy tag (back-compat)', () => {
    expect(isReconciliation({ tags: [RECONCILE_TAG] } as Transaction)).toBe(true)
  })
  it('false for ordinary transactions', () => {
    expect(isReconciliation({ tags: ['#İade'] } as Transaction)).toBe(false)
    expect(isReconciliation({} as Transaction)).toBe(false)
  })
})
