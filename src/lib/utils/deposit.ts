import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { toMajor, toMinor } from './money'
import { deterministicUuid } from './id'
import type { Account, Transaction } from '@/types'

/* Vadeli mevduat — "Vadeli Hesap" (savings) türündeki hesaba vade koşulları
   girilir: yıllık brüt faiz, vade başlangıcı/sonu, stopaj oranı.

   Hesap bankaların TL mevduatta kullandığı basit faizle yapılır:
     brüt faiz = anapara × yıllık oran × gün / 365
     stopaj    = brüt faiz × stopaj oranı   (vade sonunda banka keser)
     net faiz  = brüt − stopaj               (hesaba yatan)
   Anapara hesabın GÜNCEL bakiyesidir (vade içinde para eklenmediği varsayılır).
   Stopaj oranı vadeye ve döneme göre değiştiği için kullanıcı girer; boşsa
   DEFAULT_DEPOSIT_TAX. */

export const DEFAULT_DEPOSIT_TAX = 17.5

export interface DepositTerms {
  rate:   number   // yıllık brüt %
  start:  string   // yyyy-MM-dd
  end:    string   // yyyy-MM-dd
  taxPct: number
}

/** Hesabın geçerli vade koşulları; eksik ya da tutarsızsa null. */
export function depositTerms(a: Pick<Account, 'type' | 'depositRate' | 'depositStart' | 'depositEnd' | 'depositTaxPct'>): DepositTerms | null {
  if (a.type !== 'savings') return null
  const rate = a.depositRate ?? 0
  if (!(rate > 0) || !a.depositStart || !a.depositEnd || a.depositEnd <= a.depositStart) return null
  return { rate, start: a.depositStart, end: a.depositEnd, taxPct: a.depositTaxPct ?? DEFAULT_DEPOSIT_TAX }
}

export interface DepositProjection {
  days:          number
  gross:         number
  tax:           number
  net:           number
  maturityValue: number
  /** asOf gününe kadar işlemiş net faiz (bilgi amaçlı) */
  accruedNet:    number
  daysLeft:      number
  matured:       boolean
}

export function projectDeposit(principal: number, t: DepositTerms, asOf: string): DepositProjection {
  const start = parseISO(t.start), end = parseISO(t.end)
  const days    = differenceInCalendarDays(end, start)
  const base    = Math.max(0, principal)
  const gross   = toMajor(Math.round(toMinor(base) * (t.rate / 100) * days / 365))
  const tax     = toMajor(Math.round(toMinor(gross) * (t.taxPct / 100)))
  const net     = toMajor(toMinor(gross) - toMinor(tax))
  const elapsed = Math.min(days, Math.max(0, differenceInCalendarDays(parseISO(asOf), start)))
  return {
    days, gross, tax, net,
    maturityValue: toMajor(toMinor(base) + toMinor(net)),
    accruedNet:    days > 0 ? toMajor(Math.round(toMinor(net) * elapsed / days)) : 0,
    daysLeft:      Math.max(0, differenceInCalendarDays(end, parseISO(asOf))),
    matured:       asOf >= t.end,
  }
}

/** Aynı süre ve koşullarla yenilenmiş vade: yeni başlangıç = eski vade sonu. */
export function rolledTerms(t: DepositTerms): DepositTerms {
  const days = differenceInCalendarDays(parseISO(t.end), parseISO(t.start))
  return { ...t, start: t.end, end: format(addDays(parseISO(t.end), days), 'yyyy-MM-dd') }
}

/* ── Faiz satırı kimliği ve çift işleme koruması ─────────────────────────
   Faiz satırının kimliği hesap + vade sonundan türetilir (iOS ile AYNI formül:
   DeterministicID.uuid("deposit:<hesap>:<vade sonu>")). İki cihaz aynı vadeyi
   işlerse aynı satıra yazar — ikinci faiz satırı oluşmaz. Eski (rastgele
   kimlikli) satırlar içerikle tanınır: interestBooked. */
export const DEPOSIT_INTEREST_PREFIX = 'Vadeli mevduat faizi'

export function depositInterestId(accountId: string, end: string): string {
  return deterministicUuid(`deposit:${accountId}:${end}`)
}

/** Bu vadenin faiz satırı zaten var mı (bu cihaz, başka cihaz ya da eski kayıt). */
export function interestBooked(
  txs: readonly Pick<Transaction, 'id' | 'accountId' | 'type' | 'date' | 'description' | 'deleted_at'>[],
  accountId: string,
  end: string,
): boolean {
  const id = depositInterestId(accountId, end)
  return txs.some(t => !t.deleted_at && (t.id === id || (
    t.accountId === accountId && t.type === 'income' && t.date.slice(0, 10) === end
    && t.description.startsWith(DEPOSIT_INTEREST_PREFIX))))
}
