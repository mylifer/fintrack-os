import { addMonths, differenceInCalendarDays, format, getDate, getDaysInMonth, parseISO } from 'date-fns'
import { foldText } from '@/lib/auto-category'
import { isReconciliation } from './reconciliation'
import type { CurrencyCode, RecurringTransaction, Transaction } from '@/types'

/* Geçmişten tekrarlayan tespiti — elle girilmiş (ya da dökümden aktarılmış)
   ama henüz "Tekrarlayan" şablonu olmayan AYLIK düzenli gelir/giderleri bulur:
   kira, aidat, maaş, fatura, abonelik.

   Aday sayılmak için (hepsi):
     • aynı hesap + tür + (alıcı ya da sadeleştirilmiş açıklama),
     • son 6 ayda en az 3 FARKLI ay, ay başına tek ödeme (market gibi sık
       harcamalar elenir),
     • ayın benzer günü (medyandan en çok ±5 gün; ay sonu 28–31 aynı sayılır),
     • benzer tutar (en büyük / en küçük ≤ 1,25),
     • hâlâ sürüyor (son ödeme en çok 45 gün önce),
     • aynı açıklama/ad ya da aynı alıcıyla bir şablon zaten yok.
   Saf fonksiyon: store yok, saat asOf ile verilir. */

export interface RecurringSuggestion {
  key:         string
  name:        string
  type:        'income' | 'expense'
  accountId:   string
  categoryId?: string
  recipientId?: string
  currency:    CurrencyCode
  amount:      number      // son ödeme
  amountVaries: boolean
  count:       number
  lastDate:    string
  nextDate:    string      // son ödeme + 1 ay
  dayOfMonth:  number
  txIds:       string[]
}

const WINDOW_MONTHS = 6
const MIN_MONTHS    = 3
const MAX_DAY_DRIFT = 5
const MAX_AMOUNT_RATIO = 1.25
const MAX_SILENCE_DAYS = 45

// Ay adları ve kısaltmaları — "EV KIRASI HAZİRAN" / "… TEMMUZ" aynı grup olsun
const MONTH_WORDS = new Set([
  'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
  'oca', 'sub', 'mar', 'nis', 'haz', 'tem', 'agu', 'eyl', 'eki', 'kas', 'ara',
])

/** Açıklamanın kalıcı kısmı: rakam, noktalama ve ay adları atılır, ilk 3 kelime ("MIGROS 1234 KADIKOY" → "migros kadikoy"). */
export function recurringKeyText(s: string): string {
  return foldText(s)
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !MONTH_WORDS.has(w))
    .slice(0, 3)
    .join(' ')
}

// Ay sonuna yakın günler (28–31) tek "ay sonu" günü sayılır: 31 Ocak, 28 Şubat, 30 Nisan
function effectiveDay(iso: string): number {
  const d = parseISO(iso)
  const day = getDate(d)
  return day >= getDaysInMonth(d) - 2 ? 31 : day
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Şablon adı: özgün yazım korunur, ay adı ve rakamlı parçalar atılır ("EV KIRASI EYLUL" → "EV KIRASI"). */
export function suggestionName(description: string): string {
  const kept = description.trim().split(/\s+/).filter(tok => {
    const word = foldText(tok).replace(/[^a-z]/g, '')
    return !/\d/.test(tok) && !MONTH_WORDS.has(word)
  })
  const t = kept.join(' ').replace(/[\s\-–—/.,:;]+$/, '').trim() || description.trim()
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

export function detectRecurring(
  transactions: readonly Transaction[],
  recurring: readonly RecurringTransaction[],
  opts: { asOf: string; dismissed?: readonly string[] },
): RecurringSuggestion[] {
  const { asOf } = opts
  const windowStart = format(addMonths(parseISO(asOf), -WINDOW_MONTHS), 'yyyy-MM-dd')
  const dismissed = new Set(opts.dismissed ?? [])

  // Mevcut şablonların eşleşme anahtarları
  const templateTexts = new Set<string>()
  const templateRecipients = new Set<string>()
  for (const r of recurring) {
    if (r.deleted_at) continue
    templateTexts.add(`${r.type}|${recurringKeyText(r.name)}`)
    templateTexts.add(`${r.type}|${recurringKeyText(r.description)}`)
    if (r.recipientId) templateRecipients.add(`${r.type}|${r.accountId}|${r.recipientId}`)
  }

  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.type !== 'income' && t.type !== 'expense') continue
    const d = t.date.slice(0, 10)
    if (d < windowStart || d > asOf) continue
    if (t.isInstallment || t.installGroupId || t.debtId || t.debtPrincipalId || t.icon) continue
    if (isReconciliation(t) || !(t.amount > 0)) continue
    const text = recurringKeyText(t.description)
    if (!t.recipientId && !text) continue
    const key = `${t.type}|${t.accountId}|${t.recipientId ? `r:${t.recipientId}` : `d:${text}`}`
    const g = groups.get(key)
    if (g) g.push(t)
    else groups.set(key, [t])
  }

  const out: RecurringSuggestion[] = []
  for (const [key, txs] of groups) {
    if (dismissed.has(key)) continue
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date))
    const months = new Set(sorted.map(t => t.date.slice(0, 7)))
    if (months.size < MIN_MONTHS || sorted.length > months.size) continue

    const last = sorted[sorted.length - 1]
    if (differenceInCalendarDays(parseISO(asOf), parseISO(last.date.slice(0, 10))) > MAX_SILENCE_DAYS) continue

    const days = sorted.map(t => effectiveDay(t.date.slice(0, 10)))
    const mid = median(days)
    if (days.some(d => Math.abs(d - mid) > MAX_DAY_DRIFT)) continue

    if (new Set(sorted.map(t => t.currency)).size > 1) continue
    const amounts = sorted.map(t => t.amount)
    const lo = Math.min(...amounts), hi = Math.max(...amounts)
    if (hi / lo > MAX_AMOUNT_RATIO) continue

    const type = last.type as 'income' | 'expense'
    const text = recurringKeyText(last.description)
    if (templateTexts.has(`${type}|${text}`)) continue
    if (last.recipientId && templateRecipients.has(`${type}|${last.accountId}|${last.recipientId}`)) continue

    out.push({
      key,
      name:        suggestionName(last.description) || 'Düzenli işlem',
      type,
      accountId:   last.accountId,
      categoryId:  last.categoryId,
      recipientId: last.recipientId ?? undefined,
      currency:    last.currency,
      amount:      last.amount,
      amountVaries: hi !== lo,
      count:       sorted.length,
      lastDate:    last.date.slice(0, 10),
      nextDate:    format(addMonths(parseISO(last.date.slice(0, 10)), 1), 'yyyy-MM-dd'),
      dayOfMonth:  getDate(parseISO(last.date.slice(0, 10))),
      txIds:       sorted.map(t => t.id),
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/** Öneriden şablon: bir sonraki ödemeden başlar — geçmiş aylar yeniden üretilmez. */
export function suggestionToRecurring(s: RecurringSuggestion, id: string, now: string): RecurringTransaction {
  return {
    id,
    name:        s.name,
    type:        s.type,
    amount:      s.amount,
    currency:    s.currency,
    accountId:   s.accountId,
    categoryId:  s.categoryId,
    recipientId: s.recipientId,
    description: s.name,
    frequency:   'monthly',
    dayOfMonth:  s.dayOfMonth,
    startDate:   s.nextDate,
    nextDueDate: s.nextDate,
    isActive:    true,
    createdAt:   now,
  }
}
