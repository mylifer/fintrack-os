import { describe, it, expect, vi } from 'vitest'
import type { RecurringTransaction } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   recurring.store — getDue ve bitiş tarihi (denetim #18)

   getDue eskiden bitiş tarihini BUGÜNLE kıyaslıyordu: bitişi geçmiş bir
   şablonun bitişten önceki, uygulama açılmadığı için üretilmemiş dönemleri
   hiçbir zaman "bekleyen" görünmüyor ve sessizce kayboluyordu.
──────────────────────────────────────────────────────────────────────── */

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localPatch: async () => {},
  softDelete: async () => {},
  reconcilingPull: async () => [],
}))

const { useRecurringStore } = await import('./recurring.store')

function rec(p: Partial<RecurringTransaction>): RecurringTransaction {
  return {
    id: 'r1', name: 'Kira', type: 'expense', amount: 1000, currency: 'TRY', accountId: 'a',
    description: 'Kira', frequency: 'monthly', startDate: '2026-07-15', nextDueDate: '2026-09-15',
    isActive: true, createdAt: '2026-07-01', updatedAt: '2026-07-01',
    ...p,
  } as RecurringTransaction
}

describe('getDue — bitiş tarihi', () => {
  it('bitişi geçmiş ama bitişten önceki dönemi üretilmemiş şablon bekleyendir', () => {
    useRecurringStore.setState({ recurring: [rec({ endDate: '2026-09-30' })] })
    expect(useRecurringStore.getState().getDue('2026-10-05').map(r => r.id)).toEqual(['r1'])
  })

  it('sıradaki dönem bitişten sonraysa şablon bitmiştir', () => {
    useRecurringStore.setState({ recurring: [rec({ endDate: '2026-09-30', nextDueDate: '2026-10-15' })] })
    expect(useRecurringStore.getState().getDue('2026-10-20')).toEqual([])
  })

  it('bitişsiz ve vadesi gelmemiş şablon bekleyen değildir', () => {
    useRecurringStore.setState({ recurring: [rec({ nextDueDate: '2026-10-15' })] })
    expect(useRecurringStore.getState().getDue('2026-10-05')).toEqual([])
  })

  it('pasif şablon bekleyen değildir', () => {
    useRecurringStore.setState({ recurring: [rec({ isActive: false })] })
    expect(useRecurringStore.getState().getDue('2026-10-05')).toEqual([])
  })
})
