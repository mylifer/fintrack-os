import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import { parseTrDate } from './garanti-card'
import type { PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine, StatementSummary } from './statement'

/* ── Yapı Kredi (World) kredi kartı hesap özeti (PDF) ────────────────────────
   Başlık ("HESAP BİLGİLERİ"): Hesap Kesim Tarihi, Son Ödeme Tarihi, Dönem
   Borcu, Önceki Dönem Hesap Özeti Borcu, Dönem İçi Harcamalar / Ödemeler,
   Bir Sonraki Ay Hesap Kesim / Son Ödeme Tarihi ("18 Ekim 2026").
   Tablo: İşlem Tarihi | İşlemler | Tutar(TL) | Kalan Tutar/Taksit | Puan.
   Tutar Türkçe biçimde; "+" önekli tutar alacaktır.
   Taksit satırının TARİHİ ALIMIN tarihidir (6/6 taksit Nisan'daki alımın
   tarihini taşır); taksit bilgisi alt satırdadır: "8.134,50 TL'lik işlemin
   6 / 6 taksidi". Eşleştirme motoru taksit satırının tarihini "alım + (k−1)
   ay" kabul ettiği için tarih buna çevrilir.
   Kontrol: devir + satırlar = dönem borcu (= tablonun TOPLAM satırı). */

const AMOUNT_RE = /^\+?-?[\d.]*\d,\d{2}$/
const INST_RE = /([\d.]+,\d{2})\s*TL'lik işlemin\s*(\d+)\s*\/\s*(\d+)\s*taksidi/i
const COL_TOLERANCE = 25

const amountOf = (s: string) => {
  const t = s.trim().replace(/\s*TL$/, '')
  const v = toMajor(toMinor(Number(t.replace(/^[+-]/, '').replace(/\./g, '').replace(',', '.'))))
  return t.startsWith('+') || t.startsWith('-') ? -v : v
}

function addMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + months, d = +iso.slice(8, 10)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const first = new Date(Date.UTC(y, m, 1))
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

const PAYMENT_RE = /^odeme|odemeniz|hesaptan odeme|otomatik odeme|kart odemesi/
const FEE_RE = /faiz|bsmv|kkdf|ucret|gecikme/

function kindOf(desc: string, amount: number, dated: boolean): LineKind {
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  if (!dated || (FEE_RE.test(f) && !/ tr$/.test(f))) return 'fee'
  return 'purchase'
}

/** "Dönem Borcu : 2.171,75 TL" / "Son Ödeme Tarihi | : 28 Ekim 2026" → değer metni */
function valueOf(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    if (foldText(l.items[0]?.str ?? '').trim() !== key) continue
    const rest: string[] = []
    for (const it of l.items.slice(1)) {
      if (it.x > 330) break                                  // sağdaki adres sütunu
      rest.push(it.str)
    }
    const v = rest.join(' ').replace(/^\s*:\s*/, '').trim()
    if (v) return v
  }
  return null
}

interface Cols { descX: number; tutarRight: number; taksitX: number }

function headerCols(line: PdfLine): Cols | null {
  const tutar = line.items.find(i => foldText(i.str).startsWith('tutar'))
  const desc = line.items.find(i => foldText(i.str) === 'islemler')
  if (!tutar || !desc) return null
  const taksit = line.items.find(i => foldText(i.str).startsWith('kalan tutar'))
  return { descX: desc.x - 4, tutarRight: tutar.right, taksitX: (taksit?.x ?? tutar.right + 10) - 4 }
}

export function parseYapiKrediCard(pages: PdfPage[]): ParsedStatement | null {
  const all = pages.flatMap(p => p.lines)
  const f = foldText(all.map(l => l.text).join(' '))
  if (!f.includes('yapi ve kredi bankasi') || !f.includes('hesap kesim tarihi')) return null

  const statementDate = parseTrDate(valueOf(all, 'Hesap Kesim Tarihi') ?? '')
  if (!statementDate) throw new Error('Yapı Kredi hesap özetinde hesap kesim tarihi okunamadı.')
  const dueDate = parseTrDate(valueOf(all, 'Son Ödeme Tarihi') ?? '')
  const nextStatementDate = parseTrDate(valueOf(all, 'Bir Sonraki Ay Hesap Kesim Tarihi') ?? '')
  const nextDueDate = parseTrDate(valueOf(all, 'Bir Sonraki Ay Son Ödeme Tarihi') ?? '')
  const num = (label: string) => { const v = valueOf(all, label)?.match(/[+-]?[\d.]*\d,\d{2}/)?.[0]; return v ? Math.abs(amountOf(v)) : null }
  const debt = num('Dönem Borcu')
  const previous = num('Önceki Dönem Hesap Özeti Borcu')
  const spending = num('Dönem İçi Harcamalar')
  const payments = num('Dönem İçi Ödemeler')
  const summary: StatementSummary | null = debt != null && previous != null && spending != null && payments != null
    ? { previous, spending, fees: 0, payments, debt, minPayment: null } : null

  const cards: string[] = []
  for (const m of all.map(l => l.text).join(' ').matchAll(/\d{4}\s?\d{2}\*{2}\s?\*{4}\s?(\d{4})/g)) if (!cards.includes(m[1])) cards.push(m[1])

  interface Raw { date: string | null; desc: string; amount: number; inst: { index: number; count: number; total: number } | null }
  const raw: Raw[] = []
  let total: number | null = null
  let cols: Cols | null = null
  for (const line of all) {
    const hc = headerCols(line)
    if (hc) { cols = hc; continue }
    if (!cols) continue
    const c = cols
    const lt = foldText(line.text)
    const amountItem = line.items.find(i => AMOUNT_RE.test(i.str.trim()) && Math.abs(i.right - c.tutarRight) <= COL_TOLERANCE)
    if (lt.startsWith('toplam')) { if (amountItem) total = amountOf(amountItem.str); cols = null; continue }
    if (!amountItem) {
      const im = line.text.match(INST_RE)
      const prev = raw[raw.length - 1]
      if (im && prev && !prev.inst) prev.inst = { total: amountOf(im[1]), index: Number(im[2]), count: Number(im[3]) }
      continue
    }
    const first = line.items[0]
    const date = first && first.x < c.descX ? parseTrDate(first.str) : null
    const desc = line.items.filter(i => i !== amountItem && i.x >= c.descX && i.right <= amountItem.x + 2).map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim()
    if (!desc) continue
    raw.push({ date, desc, amount: amountOf(amountItem.str), inst: null })
  }

  const lines: StatementLine[] = raw.map((r, index) => {
    const carry = !r.date && foldText(r.desc).includes('onceki donem')
    const inst = r.inst && r.inst.count > 1 ? r.inst : null
    return {
      index,
      // Satırdaki tarih alımın tarihi → bu taksitin dönemi: alım + (k−1) ay
      date: r.date && inst ? addMonths(r.date, inst.index - 1) : r.date,
      description: carry ? 'Önceki dönem bakiyesi' : r.desc,
      amount: r.amount, bonus: null, installment: inst, foreign: null,
      kind: carry ? 'carry' : kindOf(r.desc, r.amount, r.date !== null),
    }
  })

  const issues: string[] = []
  const computedMinor = lines.reduce((s, l) => s + toMinor(l.amount ?? 0), 0)
  const computed = toMajor(computedMinor)
  const expected = debt ?? total
  if (expected == null) issues.push('Hesap özetinde dönem borcu okunamadı; toplam kontrol edilemedi.')
  const diff = expected == null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected != null && diff !== 0) issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  if (total != null && debt != null && toMinor(total) !== toMinor(debt)) issues.push('Tablonun TOPLAM satırı dönem borcuyla aynı değil.')
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Hesap özetinde işlem satırı bulunamadı.')

  return {
    bank: 'yapikredi', bankLabel: 'Yapı Kredi', type: 'credit_card', currency: 'TRY', cards,
    statementDate, dueDate, prevStatementDate: null, nextStatementDate, nextDueDate, summary, lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}
