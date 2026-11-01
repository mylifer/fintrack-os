import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine, StatementSummary } from './statement'

/* ── Garanti BBVA kredi kartı ekstresi (PDF) ─────────────────────────────────
   Tablo: İşlem Tarihi | Dönem İçi İşlemler | Kalan Borç / Taksit | Bonus (TL) | Tutar (TL)

   • Sütunlar her sayfanın başlık satırından, parçaların KONUMUNDAN bulunur:
     tutarlar sağa yaslıdır, bir tutarın Bonus mu Tutar mı olduğunu sağ kenarı
     söyler. (Metin sırasına güvenmek bonus satırlarını borç sanmaya yol açıyordu.)
   • Tutar: "1.234,56" borç, "1.234,56+" alacak (ödeme/iade). Bonus: "-" harcanan.
   • Taksit: "1.649,00x6=9.894,00 2.Taksit" — satır tarihi alım tarihi + (k−1) ay.
   • Tarihsiz satırlar: önceki dönemden devir ile faiz/ücretler.
   • Kontrol: devir + satırların toplamı = dönem borcu (kuruşu kuruşuna). */

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
}

const DATE_RE = /^(\d{1,2}) (\S+) (\d{4})$/
const AMOUNT_RE = /^-?[\d.]+,\d{2}[+-]?$/
const INSTALLMENT_RE = /([\d.]+,\d{2})\s*x\s*(\d+)\s*=\s*([\d.]+,\d{2})\s*(\d+)\s*\.\s*Taksit/i
const FOREIGN_RE = /([\d.]+,\d{2})\s*(USD|EUR|GBP|CHF)\b/

/** "30 Ekim 2026" → "2026-10-30"; tanınmazsa null. */
export function parseTrDate(s: string): string | null {
  const m = s.trim().replace(/\s+/g, ' ').match(DATE_RE)
  if (!m) return null
  const month = MONTHS[foldText(m[2])]
  const day = Number(m[1])
  const year = Number(m[3])
  if (!month || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "1.234,56" → 1234.56 (işaret ekleri yok sayılır). */
export function parseTrAmount(s: string): number {
  const body = s.trim().replace(/[+-]$/, '').replace(/^-/, '').replace(/\./g, '').replace(',', '.')
  return toMajor(toMinor(Number(body)))
}

function isGaranti(pages: PdfPage[]): boolean {
  const text = foldText(pages.flatMap(p => p.lines.map(l => l.text)).join(' '))
  return text.includes('garanti') && text.includes('hesap kesim tarihi') && text.includes('donem ici islemler')
}

/** Etiketin bulunduğu satırdan etiketten sonraki metin ("Hesap Kesim Tarihi 30 Ekim 2026"). */
function labelValue(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    const first = l.items[0]
    if (!first || foldText(first.str) !== key) continue
    return l.items.slice(1).map(i => i.str).join(' ').trim()
  }
  return null
}

const amountsIn = (s: string) => [...s.matchAll(/[\d.]+,\d{2}/g)].map(m => parseTrAmount(m[0]))

function parseSummary(lines: PdfLine[]): StatementSummary | null {
  const i = lines.findIndex(l => foldText(l.text).startsWith('onceki bakiye') && foldText(l.text).includes('donem borcunuz'))
  if (i < 0 || !lines[i + 1]) return null
  const nums = amountsIn(lines[i + 1].text)
  if (nums.length < 5) return null
  return { previous: nums[0], spending: nums[1], fees: nums[2], payments: nums[3], debt: nums[4], minPayment: nums[5] ?? null }
}

const PAYMENT_RE = /odemeniz icin tesekkur|bonusflas odeme|cep sube odeme|otomatik odeme|internet sube odeme|atm.*odeme|kart odemesi/
const FEE_RE = /faiz|bsmv|kkdf|ucret|aidat|komisyon/

function lineKind(desc: string, amount: number | null, dated: boolean): LineKind {
  const f = foldText(desc)
  if (f.includes('onceki donemden devir')) return 'carry'
  if (amount === null) return 'bonus'
  if (!dated || (FEE_RE.test(f) && amount > 0 && !f.includes('*'))) return 'fee'
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  return 'purchase'
}

interface Columns { dateX: number; descX: number; instX: number; bonusRight: number; tutarRight: number }

function headerColumns(line: PdfLine): Columns | null {
  const find = (label: string) => line.items.find(i => foldText(i.str) === foldText(label))
  const date = find('İşlem Tarihi'), desc = find('Dönem İçi İşlemler'), inst = find('Kalan Borç / Taksit')
  const bonus = find('Bonus (TL)'), tutar = find('Tutar (TL)')
  if (!date || !desc || !bonus || !tutar) return null
  return { dateX: date.x, descX: desc.x, instX: inst?.x ?? (desc.x + bonus.x) / 2, bonusRight: bonus.right, tutarRight: tutar.right }
}

/** Sütun sağ kenarına yakınlık toleransı (pt). Bonus ile Tutar arası ~100 pt. */
const COL_TOLERANCE = 25

interface RawRow { date: string | null; description: string; amount: number | null; bonus: number | null; mid: string }

function parseRow(line: PdfLine, cols: Columns): RawRow | null {
  let date: string | null = null
  const desc: string[] = []
  const mid: string[] = []
  let amount: number | null = null
  let bonus: number | null = null
  for (const it of line.items) {
    const s = it.str.trim()
    if (!s) continue
    if (date === null && it.x < cols.descX - 3 && parseTrDate(s)) { date = parseTrDate(s); continue }
    if (AMOUNT_RE.test(s) && it.x > cols.instX - 3) {
      const v = parseTrAmount(s)
      if (Math.abs(it.right - cols.tutarRight) <= COL_TOLERANCE) {
        // "+" (ya da "-") eki alacaktır: karta ödeme / iade borcu azaltır
        amount = /[+-]$/.test(s) || s.startsWith('-') ? -v : v
        continue
      }
      if (Math.abs(it.right - cols.bonusRight) <= COL_TOLERANCE) {
        bonus = s.endsWith('-') || s.startsWith('-') ? -v : v
        continue
      }
    }
    if (it.x >= cols.descX - 3 && it.x < cols.instX - 3) desc.push(s)
    else if (it.x >= cols.instX - 3) mid.push(s)
  }
  const description = desc.join(' ').replace(/\s+/g, ' ').trim()
  if (!description) return null
  if (amount === null && bonus === null) return null
  return { date, description, amount, bonus, mid: mid.join(' ') }
}

const MASK_RE = /\d{4}\s?\d{2}\*{2}\s?\*{4}\s?(\d{4})/g

export function parseGarantiCard(pages: PdfPage[]): ParsedStatement | null {
  if (!pages.length || !isGaranti(pages)) return null
  const first = pages[0].lines
  const allLines = pages.flatMap(p => p.lines)
  const fullText = allLines.map(l => l.text).join(' ')
  const foldedText = foldText(fullText)

  const statementDate = parseTrDate(labelValue(first, 'Hesap Kesim Tarihi') ?? '')
  if (!statementDate) throw new Error('Garanti ekstresinde hesap kesim tarihi okunamadı.')
  const dueDate = parseTrDate(labelValue(first, 'Son Ödeme Tarihi') ?? '')
  const debtLabel = labelValue(first, 'Dönem Borcunuz')

  // Özet paragrafı satırlara bölünebilir ("… 10 Ağustos" / "2026 …"): tek metin üzerinde aranır
  const dateAfter = (re: RegExp) => {
    const m = foldedText.match(re)
    return m ? parseTrDate(m[1]) : null
  }
  const D = '(\\d{1,2} [a-z]+ \\d{4})'
  const nextStatementDate = dateAfter(new RegExp(`bir sonraki hesap kesiminiz ${D}`))
  const nextDueDate = dateAfter(new RegExp(`bir sonraki hesap kesiminiz \\d{1,2} [a-z]+ \\d{4}.*?son odemeniz ${D}`))
  const prevStatementDate = dateAfter(new RegExp(`bir onceki hesap kesim tarihiniz ${D}`))

  const cards: string[] = []
  for (const m of fullText.matchAll(MASK_RE)) if (!cards.includes(m[1])) cards.push(m[1])

  const summary = parseSummary(allLines)

  // ── İşlem tablosu ──
  const raw: RawRow[] = []
  let tableTotal: number | null = null
  let done = false
  for (const page of pages) {
    if (done) break
    let cols: Columns | null = null
    for (const line of page.lines) {
      if (!cols) { cols = headerColumns(line); continue }
      if (foldText(line.items[0]?.str ?? '') === 'toplam') {
        const c = cols
        const t = line.items.find(i => AMOUNT_RE.test(i.str.trim()) && Math.abs(i.right - c.tutarRight) <= COL_TOLERANCE)
        tableTotal = t ? parseTrAmount(t.str) : null
        done = true
        break
      }
      const row = parseRow(line, cols)
      if (row) raw.push(row)
    }
  }

  const lines: StatementLine[] = raw.map((r, index) => {
    const im = r.mid.match(INSTALLMENT_RE)
    const fm = r.mid.match(FOREIGN_RE)
    return {
      index,
      date: r.date,
      description: r.description,
      amount: r.amount,
      bonus: r.bonus,
      installment: im ? { index: Number(im[4]), count: Number(im[2]), total: parseTrAmount(im[3]) } : null,
      foreign: fm ? { amount: parseTrAmount(fm[1]), currency: fm[2] } : null,
      kind: lineKind(r.description, r.amount, r.date !== null),
    }
  })

  // ── Kontrol: devir + satırlar = dönem borcu ──
  const issues: string[] = []
  const expected = summary?.debt ?? (debtLabel ? amountsIn(debtLabel)[0] ?? null : null) ?? tableTotal
  let computedMinor = 0
  for (const l of lines) if (l.amount !== null) computedMinor += toMinor(l.amount)
  const computed = toMajor(computedMinor)
  if (expected === null || expected === undefined) issues.push('Ekstrede dönem borcu okunamadı; toplam kontrol edilemedi.')
  const diff = expected == null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected != null && diff !== 0) {
    issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  }
  if (tableTotal !== null && expected != null && toMinor(tableTotal) !== toMinor(expected)) {
    issues.push('Tablonun "Toplam" satırı dönem borcuyla aynı değil.')
  }
  if (summary) {
    const s = toMinor(summary.previous) + toMinor(summary.spending) + toMinor(summary.fees) - toMinor(summary.payments)
    if (s !== toMinor(summary.debt)) issues.push('Ekstre özetindeki rakamlar kendi içinde tutmuyor.')
  }
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Ekstrede işlem satırı bulunamadı.')

  return {
    bank: 'garanti',
    bankLabel: 'Garanti BBVA',
    type: 'credit_card',
    currency: 'TRY',
    cards,
    statementDate,
    dueDate,
    prevStatementDate,
    nextStatementDate,
    nextDueDate,
    summary,
    lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}
