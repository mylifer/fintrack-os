import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Burgan Bank (ON Dijital) kredi kartı hesap özeti (PDF) ──────────────────
   Başlık: Hesap Kesim Tarihi, Son Ödeme Tarihi, Dönem Borcu (TL), Bir Sonraki
   Hesap Kesim / Son Ödeme Tarihi (gg/aa/yyyy).
   Tablo (kart başına "XXXX NOLU KARTIN HARCAMALARI"):
     İşlem Tarihi | İşlem Açıklama | Kalan Tutar/Taksit | MaxiPuan | Tutar
   Tutarlar İngilizce biçimde; "+" önekli tutar alacaktır (ödeme, kampanya
   iadesi). "Önceki Dönem Ekstre Borcu" devirdir. Her kartın sonunda "BU
   KARTINIZLA YAPILAN İŞLEM TOPLAMI", en sonda "Toplam Tutar" yazar.
   Kontrol: devir + satırlar = dönem borcu; her kartın satırları = kart toplamı. */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const AMOUNT_RE = /^\+?-?[\d,]*\d\.\d{2}$/
const INST_RE = /(\d+)\s*\/\s*(\d+)/
const COL_TOLERANCE = 25

const isoOf = (s: string) => { const m = s.trim().match(DATE_RE); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
/** "+16,456.17" → −16456.17 (alacak) · "1,500.00" → 1500 */
const amountOf = (s: string) => {
  const t = s.trim()
  const v = toMajor(toMinor(Number(t.replace(/^\+/, '').replace(/,/g, ''))))
  return t.startsWith('+') ? -v : v
}

const PAYMENT_RE = /borc odeme|odemeniz|kart odemesi|hesaptan odeme/
const FEE_RE = /faiz|bsmv|kkdf|ucret|gecikme/

function kindOf(desc: string, amount: number, dated: boolean): LineKind {
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  if (!dated || (FEE_RE.test(f) && !/ (tr|tu)$/.test(f))) return 'fee'
  return 'purchase'
}

/** Satırın ilk öğesi etiketse (ör. "Hesap Kesim Tarihi") satırdaki ilk tarih/tutar. */
function labelled(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    if (foldText(l.items[0]?.str ?? '').trim() !== key) continue
    const v = l.items.slice(1).map(i => i.str.trim()).find(s => DATE_RE.test(s) || AMOUNT_RE.test(s))
    if (v) return v
  }
  return null
}

interface Cols { descX: number; taksitX: number; puanX: number; tutarRight: number }

function headerCols(line: PdfLine): Cols | null {
  const find = (label: string) => line.items.find(i => foldText(i.str).replace(/:$/, '').trim() === foldText(label))
  const desc = find('İşlem Açıklama'), taksit = find('Kalan Tutar/Taksit'), puan = find('MaxiPuan'), tutar = find('Tutar')
  if (!desc || !tutar) return null
  return { descX: desc.x - 4, taksitX: (taksit?.x ?? 320) - 4, puanX: (puan?.x ?? 430) - 4, tutarRight: tutar.right }
}

export function parseBurganCard(pages: PdfPage[]): ParsedStatement | null {
  const all = pages.flatMap(p => p.lines)
  const text = all.map(l => l.text).join(' ')
  const f = foldText(text)
  if (!f.includes('burgan bank') || !f.includes('kredi karti hesap ozeti')) return null

  const statementDate = isoOf(labelled(all, 'Hesap Kesim Tarihi') ?? '')
  if (!statementDate) throw new Error('Burgan ekstresinde hesap kesim tarihi okunamadı.')
  const dueDate = isoOf(labelled(all, 'Son Ödeme Tarihi') ?? '')
  const nextStatementDate = isoOf(labelled(all, 'Bir Sonraki Hesap Kesim Tarihi') ?? '')
  const nextDueDate = isoOf(labelled(all, 'Bir Sonraki Son Ödeme Tarihi') ?? '')
  const debtText = labelled(all, 'Dönem Borcu (TL)')
  const debt = debtText ? amountOf(debtText) : null

  interface Raw { date: string | null; desc: string; amount: number; card: string | null }
  const raw: Raw[] = []
  const cards: string[] = []
  const cardTotals = new Map<string, number>()
  let total: number | null = null
  let card: string | null = null
  let cols: Cols | null = null

  for (const line of all) {
    const lt = line.text
    const sec = lt.match(/\d{4}\s?\d{2}\*{2}\s?\*{4}\s?(\d{4})\s+NOLU KARTIN/i)
    if (sec) { card = sec[1]; if (!cards.includes(card)) cards.push(card); continue }
    const fl = foldText(lt)
    if (fl.startsWith('toplam tutar')) {
      const v = line.items.map(i => i.str.trim()).find(s => AMOUNT_RE.test(s))
      if (v) total = amountOf(v)
      continue
    }
    const hc = headerCols(line)
    if (hc) { cols = hc; continue }
    if (!cols) continue
    const c = cols
    const amountItem = line.items.find(i => AMOUNT_RE.test(i.str.trim()) && Math.abs(i.right - c.tutarRight) <= COL_TOLERANCE)
    if (!amountItem) continue
    if (fl.includes('kartinizla yapilan islem toplami')) {
      if (card) cardTotals.set(card, amountOf(amountItem.str))
      continue
    }
    const date = isoOf(line.items[0]?.str ?? '')
    const desc = line.items.filter(i => i !== amountItem && i.x >= c.descX && i.x < c.taksitX).map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim()
    const mid = line.items.filter(i => i !== amountItem && i.x >= c.taksitX && i.x < c.puanX).map(i => i.str.trim()).join(' ')
    const inst = mid.match(INST_RE)
    if (!desc) continue
    raw.push({ date, desc: desc + (inst ? ` (${inst[1]}/${inst[2]})` : ''), amount: amountOf(amountItem.str), card })
  }

  const lines: StatementLine[] = raw.map((r, index) => {
    const carry = !r.date && foldText(r.desc).includes('onceki donem')
    return {
      index, date: r.date, description: carry ? 'Önceki dönem bakiyesi' : r.desc, amount: r.amount, bonus: null,
      installment: null, foreign: null, kind: carry ? 'carry' : kindOf(r.desc, r.amount, r.date !== null),
    }
  })

  // ── Kontrol ──
  const issues: string[] = []
  const computedMinor = lines.reduce((s, l) => s + toMinor(l.amount ?? 0), 0)
  const computed = toMajor(computedMinor)
  const expected = debt ?? total
  if (expected == null) issues.push('Ekstrede dönem borcu okunamadı; toplam kontrol edilemedi.')
  const diff = expected == null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected != null && diff !== 0) issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  if (total != null && debt != null && toMinor(total) !== toMinor(debt)) issues.push('Ekstrenin "Toplam Tutar"ı dönem borcuyla aynı değil.')
  for (const [k, t] of cardTotals) {
    const sum = raw.filter(r => r.card === k && r.date).reduce((s, r) => s + toMinor(r.amount), 0)
    if (sum !== toMinor(t)) issues.push(`*${k} kartının satırları kart toplamını (${t.toFixed(2)}) tutmuyor: fark ${toMajor(sum - toMinor(t)).toFixed(2)}.`)
  }
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Ekstrede işlem satırı bulunamadı.')

  return {
    bank: 'burgan', bankLabel: 'Burgan (ON)', type: 'credit_card', currency: 'TRY', cards,
    statementDate, dueDate, prevStatementDate: null, nextStatementDate, nextDueDate, summary: null, lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}
