import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PaymentSchedule } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   paymentSchedules.store + bildirim merkezi

   Eskiden sayfa, bildirim merkezi ve rozet farklı kurallar kullanıyordu: aynı
   takvim panelde hem "Onay bekleyen" hem "Yaklaşan" altında çıkıyor, sayfa
   "Yaklaşan" derken zil "vadesi geldi" diyordu. Artık hepsi resolvePeriod.
   Store Dexie + Supabase'e bağlı olduğundan I/O katmanı mock'lanır.
──────────────────────────────────────────────────────────────────────── */

const patches: { id: string; patch: Record<string, unknown> }[] = []

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/sync/engine', () => ({
  localUpsert: async () => {},
  localBulkUpsert: async () => {},
  localPatch: async (_t: string, id: string, patch: Record<string, unknown>) => { patches.push({ id, patch }) },
  localPatchMany: async () => {},
  softDelete: async () => {},
  softDeleteMany: async () => {},
  localBatch: async () => {},
  reconcilingPull: async () => [],
}))

const { usePaymentSchedulesStore } = await import('./paymentSchedules.store')
const { useUndoStore } = await import('./undo.store')
const { getNotifications, getActionableCount } = await import('./notifications.store')

const base = (p: Partial<PaymentSchedule> = {}): PaymentSchedule => ({
  id: 's1', name: 'Kart', type: 'credit_card', dueDay: 5, isActive: true,
  createdAt: '2026-09-01T09:00:00', ...p,
})

beforeEach(() => {
  patches.length = 0
  usePaymentSchedulesStore.setState({ schedules: [] })
})
afterEach(() => { vi.useRealTimers() })

function at(day: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(day + 'T10:00:00'))
}

describe('bildirimler — takvim başına tek kayıt', () => {
  it('29 Eylül, Eylül ödendi: yalnızca "upcoming" (eskiden due + upcoming ikisi birden)', () => {
    at('2026-09-29')
    usePaymentSchedulesStore.setState({ schedules: [base({ paidMonths: { '2026-09': '2026-09-05' } })] })
    const payment = getNotifications().filter(n => n.kind.startsWith('payment'))
    expect(payment).toHaveLength(1)
    expect(payment[0]).toMatchObject({ kind: 'payment-upcoming', monthKey: '2026-10', dueDate: '2026-10-05' })
    expect(getActionableCount()).toBe(0)
  })

  it('ödenmemiş geçmiş dönem tek "payment-due" üretir ve dönemi taşır', () => {
    at('2026-09-29')
    usePaymentSchedulesStore.setState({ schedules: [base()] })
    const payment = getNotifications().filter(n => n.kind.startsWith('payment'))
    expect(payment).toHaveLength(1)
    expect(payment[0]).toMatchObject({ kind: 'payment-due', monthKey: '2026-09', unpaidDueCount: 1 })
    expect(getActionableCount()).toBe(1)
  })

  it('pasif takvim bildirim üretmez', () => {
    at('2026-09-29')
    usePaymentSchedulesStore.setState({ schedules: [base({ isActive: false })] })
    expect(getNotifications().filter(n => n.kind.startsWith('payment'))).toHaveLength(0)
  })
})

describe('markPaid / unmarkPaid', () => {
  it('dönemi kapatır, Undo toast ile geri alınır', async () => {
    usePaymentSchedulesStore.setState({ schedules: [base()] })
    const st = usePaymentSchedulesStore.getState()
    expect(st.getDueToday('2026-09-23')).toHaveLength(1)

    await st.markPaid('s1', '2026-09', '2026-09-23')
    expect(patches.at(-1)).toEqual({ id: 's1', patch: { paidMonths: { '2026-09': '2026-09-23' } } })
    expect(usePaymentSchedulesStore.getState().getDueToday('2026-09-23')).toHaveLength(0)

    const toast = useUndoStore.getState().toasts.at(-1)!
    await toast.undo()
    expect(patches.at(-1)).toEqual({ id: 's1', patch: { paidMonths: {} } })
    expect(usePaymentSchedulesStore.getState().getDueToday('2026-09-23')).toHaveLength(1)
  })
})

describe('setOverride', () => {
  it('komşu dönemi aşan tarihi yazmadan reddeder', async () => {
    usePaymentSchedulesStore.setState({ schedules: [base()] })
    await expect(usePaymentSchedulesStore.getState().setOverride('s1', '2026-09', '2027-03-15')).rejects.toThrow()
    expect(patches).toHaveLength(0)
  })

  it('varsayılanla aynı tarih override yazmaz, mevcut istisnayı kaldırır', async () => {
    usePaymentSchedulesStore.setState({ schedules: [base({ overrides: { '2026-09': '2026-09-07' } })] })
    await usePaymentSchedulesStore.getState().setOverride('s1', '2026-09', '2026-09-05')
    expect(patches.at(-1)).toEqual({ id: 's1', patch: { overrides: {} } })
  })
})
