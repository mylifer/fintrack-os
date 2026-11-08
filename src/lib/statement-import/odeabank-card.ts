import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfItem, PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine, StatementSummary } from './statement'

/* ── Odeabank kredi kartı hesap özeti (PDF) ──────────────────────────────────
   Tablo: İşlem Tarihi | Dönem İçi İşlemler | Borç Tutarı (TL) | Kalan Taksit | Chip Para (TL)

   • Tutarlar ABD biçiminde: "6,218.86". Ödeme/iade "(-) 32,987.28".
   • Açıklama: işyeri · şehir · ülke ("SHELL ACIBADEM  ISTANBUL  TR"); şehir ve
     ülke açıklamaya katılmaz.
   • Taksit: ülke kodundan sonra "8/2. taksit" (8 taksitin 2.'si). Satırın tarihi
     alım tarihidir; o taksidin tarihi altındaki "03/09/2026 vadeli" satırında.
     Satır tarihi olarak taksidin tarihi alınır (diğer bankalar gibi alım + k−1 ay).
     Alımın toplamı ekstrede yok: taksit × adet ile tahmin edilir.
   • Chip Para sütunu kart borcunu etkilemez (bonus).
   • Kontrol: devir + satırlar = dönem borcu (kuruşu kuruşuna). */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const AMOUNT_RE = /^(\(-\)\s*)?-?[\d,]+\.\d{2}$/
const INST_RE = /(\d{1,2})\/(\d{1,2})\.\s*taksit/i
const VADE_RE = /^(\d{2}\/\d{2}\/\d{4})\s+vadeli$/i
const COUNTRY_RE = /^[A-Z]{2}(\s+\d{1,2}\/\d{1,2}\.\s*taksit)?$/
const MASK_RE = /\d{4}\s?\d{2}\*{2}\s?\*{4}\s?(\d{4})/
/** Sütun sağ kenarına yakınlık toleransı (pt). */
const COL_TOLERANCE = 15

function isoOf(s: string): string | null {
  const m = s.trim().replace(/^:\s*/, '').match(DATE_RE)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** "(-) 1,234.56" → −1234.56 · "6,218.86 TL" → 6218.86 */
function amountOf(s: string): number {
  const t = s.trim().replace(/^:\s*/, '').replace(/\s*TL$/, '')
  const neg = /^\(-\)/.test(t) || t.startsWith('-')
  const v = toMajor(toMinor(Number(t.replace(/^\(-\)\s*/, '').replace(/^-/, '').replace(/,/g, ''))))
  return neg ? -v : v
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function isOdeabankCard(pages: PdfPage[]): boolean {
  const text = foldText(pages.flatMap(p => p.lines.map(l => l.text)).join(' '))
  return text.includes('odea bank') && text.includes('hesap kesim tarihi') && text.includes('donem ici islemler') && text.includes('chip para')
}

/** Üst bilgideki "Etiket : değer" — değer, etiketin sağındaki ":" ile başlayan parça */
function labelValue(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    const i = l.items.findIndex(it => foldText(it.str.trim()) === key)
    if (i < 0) continue
    const v = l.items.slice(i + 1).find(it => it.str.trim().startsWith(':'))
    if (v) return v.str.trim().replace(/^:\s*/, '')
  }
  return null
}

const PAYMENT_RE = /odemeniz icin tesekkur|odeme/
const FEE_RE = /faiz|bsmv|kkdf|ucret|aidat|komisyon/

function kindOf(desc: string, amount: number | null): LineKind {
  if (amount === null) return 'bonus'
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  if (FEE_RE.test(f) && !f.includes('*') && !f.includes('/')) return 'fee'
  return 'purchase'
}

interface Columns { descX: number; amountRight: number; chipRight: number }

function headerColumns(items: PdfItem[]): Columns | null {
  const find = (label: string) => items.find(i => foldText(i.str.trim()) === label)
  const date = find('islem tarihi'), desc = find('donem ici islemler'), amount = find('borc tutari (tl)'), chip = find('chip para (tl)')
  if (!date || !desc || !amount || !chip) return null
  return { descX: desc.x, amountRight: amount.right, chipRight: chip.right }
}

interface Raw { date: string | null; desc: string; amount: number | null; bonus: number | null; inst: { index: number; count: number } | null; carry: boolean }

export function parseOdeabankCard(pages: PdfPage[]): ParsedStatement | null {
  if (!pages.length || !isOdeabankCard(pages)) return null
  const first = pages[0].lines
  const allLines = pages.flatMap(p => p.lines)

  const statementDate = isoOf(labelValue(first, 'Hesap Kesim Tarihi') ?? '')
  if (!statementDate) throw new Error('Odeabank ekstresinde hesap kesim tarihi okunamadı.')
  const dueDate = isoOf(labelValue(first, 'Son Ödeme Tarihi') ?? '')
  const periodStart = isoOf(labelValue(first, 'Dönem Başlangıç Tarihi') ?? '')
  const nextStatementDate = isoOf(labelValue(first, 'Bir Sonraki Hesap Kesim Tarihi') ?? '')
  const nextDueDate = isoOf(labelValue(first, 'Bir Sonraki Son Ödeme Tarihi') ?? '')
  const minLabel = labelValue(first, 'Asgari Ödeme Tutarı')
  const debtLabel = labelValue(first, 'Dönem Borcu')
  const card = allLines.map(l => l.text.match(MASK_RE)?.[1]).find(Boolean)

  // Özet: "(+) Önceki Hesap Bakiyeniz …" başlığının altındaki beş tutar
  let summary: StatementSummary | null = null
  const si = allLines.findIndex(l => foldText(l.text).includes('onceki hesap bakiyeniz') && foldText(l.text).includes('donem borcunuz'))
  if (si >= 0) {
    const row = allLines.slice(si + 1, si + 4).find(l => (l.text.match(/[\d,]+\.\d{2} TL/g) ?? []).length >= 5)
    const nums = row ? [...row.text.matchAll(/[\d,]+\.\d{2}/g)].map(m => amountOf(m[0])) : []
    if (nums.length >= 5) {
      summary = { previous: nums[0], spending: nums[1], fees: nums[2], payments: nums[3], debt: nums[4], minPayment: minLabel ? amountOf(minLabel) : null }
    }
  }

  // ── İşlem tablosu ──
  const raw: Raw[] = []
  let tableTotal: number | null = null
  let done = false
  for (const page of pages) {
    if (done) break
    let cols: Columns | null = null
    for (const line of page.lines) {
      const items = line.items.map(i => ({ ...i, str: i.str.trim() })).filter(i => i.str)
      const h = headerColumns(items)
      if (h) { cols = h; continue }
      if (!cols || !items.length) continue
      const c = cols
      const lt = foldText(line.text)
      const amountItem = items.find(i => AMOUNT_RE.test(i.str) && Math.abs(i.right - c.amountRight) <= COL_TOLERANCE)
      if (lt.startsWith('toplam borc')) { tableTotal = amountItem ? amountOf(amountItem.str) : null; done = true; break }
      if (lt.startsWith('ara toplam')) continue

      // Taksit satırının altındaki "… vadeli": o taksidin tarihi
      const vade = items.length === 1 ? items[0].str.match(VADE_RE) : null
      if (vade) {
        const prev = raw[raw.length - 1]
        if (prev?.inst) prev.date = isoOf(vade[1]) ?? prev.date
        continue
      }

      const date = isoOf(items[0].str)
      const carry = lt.startsWith('onceki donem hesap ozeti bakiyesi')
      if (!date && !carry) continue
      const chipItem = items.find(i => /^-?[\d,]+\.\d{2}$/.test(i.str) && Math.abs(i.right - c.chipRight) <= COL_TOLERANCE)
      if (!amountItem && !chipItem) continue

      const descItems = items.filter(i => i.x >= c.descX - 3 && i.right <= (amountItem?.x ?? c.amountRight) && i !== items[0])
      const inst = descItems.map(i => i.str.match(INST_RE)).find(Boolean)
      // Sondan: ülke kodu (+taksit), önündeki şehir açıklamaya katılmaz
      const parts = descItems.map(i => i.str)
      if (parts.length > 1 && COUNTRY_RE.test(parts[parts.length - 1])) {
        parts.pop()
        if (parts.length > 1 && /^[\p{Lu}İ .-]+$/u.test(parts[parts.length - 1])) parts.pop()
      }
      const desc = (carry ? 'Önceki dönem bakiyesi' : parts.join(' ')).replace(/\s+/g, ' ').trim()
      raw.push({
        date: carry ? null : date,
        desc,
        amount: amountItem ? amountOf(amountItem.str) : null,
        bonus: chipItem ? amountOf(chipItem.str) : null,
        inst: inst ? { count: Number(inst[1]), index: Number(inst[2]) } : null,
        carry,
      })
    }
  }

  const lines: StatementLine[] = raw.map((r, index) => ({
    index,
    date: r.date,
    description: r.desc,
    amount: r.amount,
    bonus: r.bonus,
    installment: r.inst && r.amount !== null && r.inst.index <= r.inst.count
      ? { index: r.inst.index, count: r.inst.count, total: toMajor(toMinor(r.amount) * r.inst.count) }
      : null,
    foreign: null,
    kind: r.carry ? 'carry' : kindOf(r.desc, r.amount),
  }))

  // ── Kontrol: devir + satırlar = dönem borcu ──
  const issues: string[] = []
  const expected = summary?.debt ?? (debtLabel ? amountOf(debtLabel) : null) ?? tableTotal
  const computedMinor = lines.reduce((s, l) => s + (l.amount === null ? 0 : toMinor(l.amount)), 0)
  const computed = toMajor(computedMinor)
  if (expected === null) issues.push('Ekstrede dönem borcu okunamadı; toplam kontrol edilemedi.')
  const diff = expected === null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected !== null && diff !== 0) {
    issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  }
  if (tableTotal !== null && expected !== null && toMinor(tableTotal) !== toMinor(expected)) {
    issues.push('Tablonun "Toplam Borç" satırı dönem borcuyla aynı değil.')
  }
  if (summary) {
    const s = toMinor(summary.previous) + toMinor(summary.spending) + toMinor(summary.fees) - toMinor(summary.payments)
    if (s !== toMinor(summary.debt)) issues.push('Ekstre özetindeki rakamlar kendi içinde tutmuyor.')
  }
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Ekstrede işlem satırı bulunamadı.')

  return {
    bank: 'odeabank',
    bankLabel: 'Odeabank',
    type: 'credit_card',
    currency: 'TRY',
    cards: card ? [card] : [],
    statementDate,
    dueDate,
    prevStatementDate: periodStart ? dayBefore(periodStart) : null,
    nextStatementDate,
    nextDueDate,
    summary,
    lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}
