import { foldText } from '@/lib/auto-category'
import type { Account, PaymentPlan } from '@/types'
import type { CardDays, HolidayRule } from './card-cycles'

/* ── Bankaların kesim / son ödeme kuralları ───────────────────────────────────
   Yasa: hesap kesim ile son ödeme arasında on günden az süre olamaz (5464
   sayılı Banka Kartları ve Kredi Kartları Kanunu md. 26). Bankalar pratikte tam
   10 gün uygular (Garanti BBVA örneği: kesim 1 Mayıs → son ödeme 11 Mayıs;
   Worldcard/QNB: "kesimden 10 gün sonra"; Vakıfbank tablosu: her satır +10).

   Tatil: son ödeme hafta sonuna / resmi tatile denk gelirse ilk iş gününe
   kayar — tüm bankalarda ortak.
     • 'due'  — yalnız son ödeme kayar, kesim yerinde kalır (bankaların
                açıklamaları; yayımlanmış tarih tablosu olmadığı için doğrulanamadı).
     • 'both' — kesim ve son ödeme BİRLİKTE kayar, fark hep 10 gün kalır.
                Vakıfbank'ın 2026 tablosu: 96 satırın 94'ü bu kuralla birebir.
   Kart başına bu iki ayar Kart Takvimi'nden değiştirilebilir; ay bazında
   istisna o ayın hücresine girilir. */

export interface BankRule {
  key: string
  label: string
  gapDays: number
  holidayRule: HolidayRule
  note: string
}

const DEFAULT_NOTE = 'Kesimden 10 gün sonra; son ödeme tatile denk gelirse ilk iş günü.'

const RULES: { match: RegExp; rule: BankRule }[] = [
  { match: /vakif/, rule: { key: 'vakif', label: 'VakıfBank', gapDays: 10, holidayRule: 'both',
      note: 'Kesimden 10 gün sonra; son ödeme tatile denk gelecekse kesim de aynı gün sayısı kadar ileri kayar (VakıfBank tarih tablosu).' } },
  { match: /garanti|bonus|miles.?smiles|shop.?fly/, rule: { key: 'garanti', label: 'Garanti BBVA', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /yapi ?kredi|world ?card|adios/, rule: { key: 'yapikredi', label: 'Yapı Kredi', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /qnb|finansbank|cardfinans|enpara/, rule: { key: 'qnb', label: 'QNB', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /kuveyt/, rule: { key: 'kuveyt', label: 'Kuveyt Türk', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /odea/, rule: { key: 'odea', label: 'Odeabank', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /burgan/, rule: { key: 'burgan', label: 'Burgan Bank', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /is ?bank|maximum|isbank/, rule: { key: 'isbank', label: 'İş Bankası', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /akbank|axess|wings/, rule: { key: 'akbank', label: 'Akbank', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /ziraat|bankkart/, rule: { key: 'ziraat', label: 'Ziraat', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /halk|paraf/, rule: { key: 'halkbank', label: 'Halkbank', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
  { match: /deniz/, rule: { key: 'denizbank', label: 'DenizBank', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE } },
]

const FALLBACK: BankRule = { key: 'other', label: 'Diğer banka', gapDays: 10, holidayRule: 'due', note: DEFAULT_NOTE }

/** Kart adından banka kuralı (bulunamazsa genel kural). */
export function bankRuleFor(cardName: string): BankRule {
  const n = foldText(cardName)
  return RULES.find(r => r.match.test(n))?.rule ?? FALLBACK
}

/** Kesim günü + fark → ayın nominal son ödeme günü (30 günlük ay yaklaşımı). */
export function nominalDueDay(statementDay: number, gapDays: number): number {
  return ((statementDay + gapDays - 1) % 30) + 1
}

/** Kesimden son ödemeye gün sayısı (girilen iki gün arasından, 30 günlük ay). */
export function gapBetween(statementDay: number, dueDay: number): number {
  const g = (dueDay - statementDay + 30) % 30
  return g === 0 ? 30 : g
}

export const MIN_GAP = 10
export const MAX_GAP = 15

export interface ResolvedCard {
  days: CardDays
  rule: BankRule
  /** Girilmiş son ödeme günü kesime göre olağan dışı (yasal 10 günün altı ya da 15+) */
  inconsistent: { gap: number; suggestDue: number; suggestClosing: number } | null
}

/**
 * Kartın geçerli günleri:
 *  • fark (gapDays): kartta kayıtlıysa o; değilse girilmiş son ödeme günü kesime
 *    göre 10–15 gün sonraysa ondan türetilir; son ödeme hiç girilmemişse banka
 *    kuralı (10). Fark varsa son ödeme her ay kesim + fark'tan hesaplanır.
 *  • Olağan dışı bir son ödeme günü girilmişse (ör. kesim 11, son ödeme 16)
 *    o gün aynen kullanılır ama inconsistent ile işaretlenir.
 */
export function resolveCardDays(
  account: Pick<Account, 'name' | 'statementDay' | 'dueGapDays' | 'holidayRule'>,
  plan: Pick<PaymentPlan, 'dayOfMonth'> | null | undefined,
): ResolvedCard {
  const rule = bankRuleFor(account.name)
  const sd = account.statementDay ?? null
  const dueDay = plan?.dayOfMonth ?? null
  const holidayRule = account.holidayRule ?? rule.holidayRule
  let gapDays: number | null = account.dueGapDays ?? null
  let inconsistent: ResolvedCard['inconsistent'] = null

  if (gapDays === null && sd !== null) {
    if (dueDay === null) gapDays = rule.gapDays
    else {
      const g = gapBetween(sd, dueDay)
      // Tam bankanın farkı → kesim + fark (ay uzunluğuna göre doğru gün);
      // 11–15 gün → girilen sabit gün korunur (bankadan okunmuş olabilir);
      // yasal 10 günün altı ya da 15+ → işaretlenir.
      if (g === rule.gapDays) gapDays = g
      else if (g < MIN_GAP || g > MAX_GAP) inconsistent = {
        gap: g,
        suggestDue: nominalDueDay(sd, rule.gapDays),
        suggestClosing: ((dueDay - rule.gapDays - 1 + 60) % 30) + 1,
      }
    }
  }
  return { days: { statementDay: sd, dueDay, gapDays, holidayRule }, rule, inconsistent }
}
