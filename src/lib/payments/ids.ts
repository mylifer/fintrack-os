import { deterministicUuid } from '@/lib/utils/id'
import type { PaymentTargetKind } from '@/types'

/* Ödeme takibi kayıtlarının kimlikleri DETERMİNİSTİKTİR: aynı hedef için tek
   plan, aynı hedef + ay için tek kayıt olur. İki sekme ya da iki cihaz aynı ayı
   aynı anda düzenlese bile sync katmanı tek satıra upsert eder, kopya oluşmaz.
   Store bu dosyayı schedule.ts yerine buradan alır — saf hesap modülünü
   store'a bağlamamak için. */

export function planIdFor(kind: PaymentTargetKind, targetId: string): string {
  return deterministicUuid(`payplan:${kind}:${targetId}`)
}

export function occurrenceIdFor(kind: PaymentTargetKind, targetId: string, month: string): string {
  return deterministicUuid(`payocc:${kind}:${targetId}:${month}`)
}
