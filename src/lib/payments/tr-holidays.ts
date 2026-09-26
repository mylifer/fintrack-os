/* ── Türkiye resmi tatilleri ve iş günü ─────────────────────────────────────
   Kredi kartı son ödeme tarihi hafta sonuna ya da resmi tatile denk gelirse
   bankalar onu ilk iş gününe kaydırır (bkz. bank-rules.ts). Bu modül "iş günü
   mü?" sorusunu yanıtlar.

   • Sabit tatiller: 1 Ocak, 23 Nisan, 1 Mayıs, 19 Mayıs, 15 Temmuz, 30 Ağustos,
     29 Ekim.
   • Dini bayramlar (Diyanet takvimi) yıl yıl aşağıda. Arife günleri ve 28 Ekim
     YARIM gündür — bankalar öğleye kadar açık, ödeme işlenir; iş günü sayılır.
   • Listede olmayan yılın dini bayramları bilinmez: o yıl yalnız hafta sonu ve
     sabit tatiller dikkate alınır. Yeni yıl eklemek için RELIGIOUS'a satır ekle.
   Kaynak: 2026–2027 resmi tatil takvimleri (Diyanet İşleri Başkanlığı). */

const FIXED = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']

// Bayramın TAM günleri (arife hariç)
const RELIGIOUS: Record<number, string[]> = {
  2024: ['04-10', '04-11', '04-12', '06-16', '06-17', '06-18', '06-19'],
  2025: ['03-30', '03-31', '04-01', '06-06', '06-07', '06-08', '06-09'],
  2026: ['03-20', '03-21', '03-22', '05-27', '05-28', '05-29', '05-30'],
  2027: ['03-09', '03-10', '03-11', '05-16', '05-17', '05-18', '05-19'],
}

export const HOLIDAY_YEARS = Object.keys(RELIGIOUS).map(Number)

export function isHoliday(iso: string): boolean {
  const year = Number(iso.slice(0, 4))
  const md = iso.slice(5, 10)
  return FIXED.includes(md) || (RELIGIOUS[year]?.includes(md) ?? false)
}

export function isBusinessDay(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  return dow !== 0 && dow !== 6 && !isHoliday(iso)
}

export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** Verilen gün iş günüyse kendisi, değilse sonraki ilk iş günü. */
export function nextBusinessDay(iso: string): string {
  let d = iso
  for (let i = 0; i < 15 && !isBusinessDay(d); i++) d = addDaysIso(d, 1)
  return d
}
