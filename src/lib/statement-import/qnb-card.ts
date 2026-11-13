import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import { parseTrDate } from './garanti-card'
import type { PdfItem, PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine, StatementSummary } from './statement'

/* ── QNB kredi kartı ─────────────────────────────────────────────────────────
   İki belge:
   1. Ekstre ("EKSTRE HAREKETLERİ"): kesilmiş dönem. Tablo: İşlem Tarihi |
      İşlem Açıklaması | Tutar | Taksit | ParaPuan. Tutarlar İngilizce biçimde
      ("3,686.85", "-24.21"). Kontrol: önceki dönem bakiyesi + satırlar = dönem
      borcu (Genel Toplam).
   2. Dönem içi işlemler ("… kartınıza ait Dönem İçi Hareketler"): henüz
      ekstresi kesilmemiş harcamalar. Tutar "1307,5 TRY". Toplam olmadığı için
      kontrol yapılamaz; `provisional` işaretlenir (Kart Takvimi'ne dokunulmaz).

   Ekstre PDF'inde bazı Türkçe harfler ayrı bir yazı tipinde, belgeye göre
   değişen denetim kodlarıyla gelir ("Ö" yerine \u0004). Bu kodlar atılır;
   eşleştirme tarih ve tutarla yapıldığı için harf kaybı sonucu değiştirmez.
   Öğrenmede önemli birkaç kalıp (ödeme, "alşv ind", İstanbul) onarılır.
   ParaPuan satırları (puan sütunu) kart borcunu etkilemez, okunmaz. */

const CONTROL_RE = /[\u0000-\u001f]/g
const clean = (s: string) => s.replace(CONTROL_RE, '')
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const US_AMOUNT_RE = /^-?[\d,]*\d\.\d{2}$/
const TR_AMOUNT_RE = /^(-?[\d.]*\d(?:,\d+)?)\s*TRY$/
const MASK_RE = /\d{4}\s?\d{2}\*{2}\s?\*{4}\s?(\d{4})/g
const COL_TOLERANCE = 25

const isoOf = (s: string) => { const m = s.match(DATE_RE); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const usAmount = (s: string) => toMajor(toMinor(Number(s.replace(/,/g, ''))))
const trAmount = (s: string) => toMajor(toMinor(Number(s.replace(/\./g, '').replace(',', '.'))))

/** Harf kaybından etkilenen birkaç kalıbı onarır (iki belge aynı metni versin diye). */
function repair(desc: string): string {
  return desc
    .replace(/\s+/g, ' ')
    .replace(/^deme - Tesekk ?r Ederiz/i, 'Ödeme - Tesekkür Ederiz')
    .replace(/(^|[\s/-])DEME\b/g, '$1ÖDEME')
    .replace(/\bal ?v ind\b/i, 'alşv ind')
    .replace(/(^|\s)STANBU(L?)\b/g, '$1İSTANBU$2')
    .trim()
}

const PAYMENT_RE = /odeme - tesekkur|odemeniz icin|hesaptan odeme|otomatik odeme/
const FEE_RE = /faiz|bsmv|kkdf|ucret|aidat|komisyon|gecikme/

function kindOf(desc: string, amount: number, dated: boolean): LineKind {
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  if (!dated || (FEE_RE.test(f) && !f.includes('/'))) return 'fee'
  return 'purchase'
}

const textOf = (pages: PdfPage[]) => pages.flatMap(p => p.lines.map(l => clean(l.text))).join(' ')

// ── 1. Ekstre ───────────────────────────────────────────────────────────────

interface Cols { descX: number; tutarRight: number; taksitX: number }

function headerCols(line: PdfLine): Cols | null {
  const tutar = line.items.find(i => clean(i.str).trim() === 'Tutar')
  const taksit = line.items.find(i => clean(i.str).trim() === 'Taksit')
  const para = line.items.find(i => clean(i.str).trim() === 'ParaPuan')
  if (!tutar || !taksit || !para) return null
  const desc = line.items.find(i => i.x > 100 && i.x < tutar.x - 100)
  return { descX: (desc?.x ?? 124) - 6, tutarRight: tutar.right, taksitX: taksit.x - 10 }
}

function parseSummary(lines: PdfLine[]): StatementSummary | null {
  for (const l of lines) {
    const nums = l.items.map(i => clean(i.str).replace(/\s*TL$/, '').trim()).filter(s => US_AMOUNT_RE.test(s))
    if (nums.length !== 7 || !/TL$/.test(clean(l.items[l.items.length - 1].str).trim())) continue
    const v = nums.map(usAmount)
    // Önceki bakiye | Harcamalar ve nakit avans | Ücretler | Faiz | Vergi ve fon | Ödemeler ve alacaklar | Dönem borcu
    return { previous: v[0], spending: v[1], fees: toMajor(toMinor(v[2]) + toMinor(v[3]) + toMinor(v[4])), payments: Math.abs(v[5]), debt: v[6], minPayment: null }
  }
  return null
}

export function parseQnbStatement(pages: PdfPage[]): ParsedStatement | null {
  const text = textOf(pages)
  const f = foldText(text)
  if (!f.includes('qnb') || !f.includes('hesap kesim tarihi') || !f.includes('kredi karti numarasi')) return null
  const all = pages.flatMap(p => p.lines)

  const lineWith = (label: string) => all.find(l => foldText(clean(l.text)).startsWith(foldText(label)))
  const firstDate = (l?: PdfLine) => l?.items.map(i => isoOf(clean(i.str).trim())).find(Boolean) ?? null
  const statementDate = firstDate(lineWith('Hesap Kesim Tarihi'))
  if (!statementDate) throw new Error('QNB ekstresinde hesap kesim tarihi okunamadı.')
  const dueM = f.match(/deme tarihi:\s*(\d{1,2} [a-z]+ \d{4})/)
  const dueDate = dueM ? parseTrDate(dueM[1]) : null
  const nextM = text.match(/bir sonraki hesap kesim tarihiniz\s*(\d{2}\/\d{2}\/\d{4}).*?tarihiniz\s*(\d{2}\/\d{2}\/\d{4})/i)
  const nextStatementDate = nextM ? isoOf(nextM[1]) : null
  const nextDueDate = nextM ? isoOf(nextM[2]) : null

  const cards: string[] = []
  for (const m of text.matchAll(MASK_RE)) if (!cards.includes(m[1])) cards.push(m[1])

  // ── Tablo ──
  interface Raw { date: string | null; desc: string; amount: number }
  const raw: Raw[] = []
  let total: number | null = null
  let cols: Cols | null = null
  let done = false
  for (const line of all) {
    if (done) break
    if (!cols) { cols = headerCols(line); continue }
    const c = cols
    const items = line.items.map(i => ({ ...i, str: clean(i.str).trim() })).filter(i => i.str)
    const amountItem = items.find(i => US_AMOUNT_RE.test(i.str) && Math.abs(i.right - c.tutarRight) <= COL_TOLERANCE)
    const lt = foldText(items.map(i => i.str).join(' '))
    if (lt.startsWith('genel toplam')) { total = amountItem ? usAmount(amountItem.str) : null; done = true; continue }
    if (!amountItem) continue                                         // ParaPuan, sipariş kodu, kart başlığı …
    const date = items[0] && items[0].x < c.descX ? isoOf(items[0].str) : null
    const desc = items.filter((i: PdfItem) => i !== amountItem && i.x >= c.descX && i.x < c.taksitX && !DATE_RE.test(i.str)).map(i => i.str).join(' ')
    const taksit = items.find(i => i.x >= c.taksitX && i !== amountItem && /^\d+\/\d+$/.test(i.str))
    raw.push({ date, desc: repair(desc) + (taksit ? ` (${taksit.str})` : ''), amount: usAmount(amountItem.str) })
  }

  const lines: StatementLine[] = raw.map((r, index) => {
    const carry = !r.date && /nceki d ?nem bakiye/.test(foldText(r.desc))
    return {
      index, date: r.date, description: carry ? 'Önceki dönem bakiyesi' : r.desc, amount: r.amount, bonus: null,
      installment: null, foreign: null, kind: carry ? 'carry' : kindOf(r.desc, r.amount, r.date !== null),
    }
  })

  const summary = parseSummary(all)
  const issues: string[] = []
  const computedMinor = lines.reduce((s, l) => s + toMinor(l.amount ?? 0), 0)
  const computed = toMajor(computedMinor)
  const expected = summary?.debt ?? total
  if (expected == null) issues.push('Ekstrede dönem borcu okunamadı; toplam kontrol edilemedi.')
  const diff = expected == null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected != null && diff !== 0) issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  if (total != null && expected != null && toMinor(total) !== toMinor(expected)) issues.push('Tablonun "Genel Toplam" satırı dönem borcuyla aynı değil.')
  if (summary && toMinor(summary.previous) + toMinor(summary.spending) + toMinor(summary.fees) - toMinor(summary.payments) !== toMinor(summary.debt)) {
    issues.push('Ekstre özetindeki rakamlar kendi içinde tutmuyor.')
  }
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Ekstrede işlem satırı bulunamadı.')

  return {
    bank: 'qnb', bankLabel: 'QNB', type: 'credit_card', currency: 'TRY', cards,
    statementDate, dueDate, prevStatementDate: null, nextStatementDate, nextDueDate, summary, lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}

// ── 2. Dönem içi işlemler ───────────────────────────────────────────────────

export function parseQnbPeriod(pages: PdfPage[]): ParsedStatement | null {
  const text = textOf(pages)
  const head = foldText(text).match(/(\d{2}\/\d{2}\/\d{4}) tarihli son 4 hanesi (\d{4}) olan kartiniza ait donem ici hareketler/)
  if (!head) return null
  const asOf = isoOf(head[1])!

  interface Raw { date: string; desc: string; amount: number }
  const raw: Raw[] = []
  // Sayfa başında başlık tekrarlanmayabilir: sütunlar sayfadan sayfaya taşınır
  let tutarRight: number | null = null
  let descX = 90
  for (const page of pages) {
    for (const line of page.lines) {
      const items = line.items.map(i => ({ ...i, str: clean(i.str).trim() })).filter(i => i.str)
      const tutar = items.find(i => i.str === 'Tutar')
      if (tutar) { tutarRight = tutar.right; descX = (items.find(i => foldText(i.str) === 'aciklama')?.x ?? 96) - 6; continue }
      if (tutarRight === null) continue
      const date = items[0] ? isoOf(items[0].str) : null
      const amountItem = items.find(i => TR_AMOUNT_RE.test(i.str) && Math.abs(i.right - tutarRight!) <= COL_TOLERANCE)
      if (!date || !amountItem) continue
      const amount = trAmount(amountItem.str.match(TR_AMOUNT_RE)![1])
      if (amount === 0) continue                                      // ParaPuan geri alımı vb.
      const desc = items.filter(i => i !== items[0] && i.x >= descX && i.right < amountItem.x).map(i => i.str).join(' ')
      raw.push({ date, desc: repair(desc), amount })
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date))

  const lines: StatementLine[] = raw.map((r, index) => ({
    index, date: r.date, description: r.desc, amount: r.amount, bonus: null, installment: null, foreign: null,
    kind: kindOf(r.desc, r.amount, true),
  }))
  const computed = toMajor(lines.reduce((s, l) => s + toMinor(l.amount!), 0))
  const issues = lines.length ? [] : ['Listede işlem satırı bulunamadı.']
  return {
    bank: 'qnb', bankLabel: 'QNB', type: 'credit_card', currency: 'TRY', cards: [head[2]],
    statementDate: asOf, dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null, lines,
    check: { ok: issues.length === 0, computed, expected: computed, diff: 0, issues },
    provisional: true,
  }
}
