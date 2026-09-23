import type { PaymentSchedule, PaymentScheduleType } from '@/types'
import { resolvePeriod, type PaymentPeriodStatus, type ResolvedPeriod } from '@/lib/utils/paymentSchedule'

/* ── Ödeme Takvimi board'ları — paylaşılan çözümleme ──────────────────────
   Timeline ve Console görünümleri, bildirim merkezi ve kenar çubuğu rozeti
   AYNI kuralı kullanır (lib/utils/paymentSchedule.ts → resolvePeriod): ödenmemiş
   en eski dönem. Böylece sayfa "Yaklaşan" derken bildirim "vadesi geldi" demez. */

export type PaymentDisplayStatus = PaymentPeriodStatus

export interface ResolvedSchedule extends ResolvedPeriod {
  schedule: PaymentSchedule
}

export function resolveDisplay(schedule: PaymentSchedule, asOf: string): ResolvedSchedule {
  return { schedule, ...resolvePeriod(schedule, asOf) }
}

export function countdownLabel(r: ResolvedSchedule): string {
  if (r.status === 'today') return 'Bugün'
  if (r.status === 'overdue') return `${Math.abs(r.daysDelta)}g gecikti`
  return `${r.daysDelta}g kaldı`
}

export const STATUS_BADGE: Record<PaymentDisplayStatus, { label: string; variant: 'danger' | 'today' | 'warning' | 'outline' }> = {
  overdue:  { label: 'Gecikmiş', variant: 'danger' },
  today:    { label: 'Bugün',    variant: 'today' },
  upcoming: { label: 'Yaklaşan', variant: 'warning' },
  normal:   { label: '',         variant: 'outline' },
}

export const PAYMENT_TYPE_LABEL: Record<PaymentScheduleType, string> = {
  credit_card: 'Kredi Kartı', loan: 'Kredi', other: 'Diğer',
}
