import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfLine, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine, StatementSummary } from './statement'

/* ── Kuveyt Türk kredi kartı ekstresi (PDF) ─────────────────────────────────
   Tablo: İŞLEM TARİHİ | İŞLEM AÇIKLAMASI | (şehir, ülke, taksit) | TUTAR | ALTIN PUAN

   • Tutar TR biçiminde, "TL" ekli: "1.350,00 TL"; ödeme "-1.350,00 TL".
   • Taksit: "Taksit - ÖZEL DURU …" ve ayrı parçada "6.750,00 TL İşlemin 3 / 5
     Taksidi". Satırın tarihi ALIM tarihidir; diğer bankalarla aynı olsun diye
     satır tarihi alım + (k−1) ay alınır.
   • Önceki dönemden devir tabloda yok, özetten (Devreden Bakiye) eklenir.
   • Altın Puan sütunu bonus (ABD biçimi "0.00"), borcu etkilemez.
   • Kontrol: devir + satırlar = dönem borcu. */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const TL_RE = /^-?[\d.]+,\d{2}(\s*TL)?$/
const INST_RE = /([\d.]+,\d{2})\s*TL\s*İşlemin\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*Taksidi/i
const MASK_RE = /\d{6}\*{6}(\d{4})/
const COUNTRY_RE = /^[A-Z]{2}$/

function isoOf(s: string): string | null {
  const m = s.trim().match(DATE_RE)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** "-1.350,00 TL" → −1350 */
function trAmount(s: string): number {
  const t = s.trim().replace(/\s*TL$/, '')
  const v = toMajor(toMinor(Number(t.replace(/^-/, '').replace(/\./g, '').replace(',', '.'))))
  return t.startsWith('-') ? -v : v
}

/** Ay ekler; kısa ayda ay sonuna sıkışır (31 Oca + 1 ay → 28 Şub). */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

function isKuveyt(pages: PdfPage[]): boolean {
  const text = foldText(pages.flatMap(p => p.lines.map(l => l.text)).join(' '))
  return text.includes('kuveyt turk') && text.includes('kredi karti ekstresi') && text.includes('hesap kesim tarihi')
}

/** "Hesap Kesim Tarihi / Statement Issue Date …  23/10/2026": etiket satırının en sağdaki parçası */
function labelValue(lines: PdfLine[], label: string): string | null {
  const key = foldText(label)
  for (const l of lines) {
    const first = l.items[0]
    if (!first || foldText(first.str.trim().replace(/\s*\/$/, '')) !== key) continue
    return l.items[l.items.length - 1].str.trim()
  }
  return null
}

const PAYMENT_RE = /borc odeme|odemeniz|odeme/
const FEE_RE = /kar payi|gecikme|bsmv|kkdf|ucret|aidat|komisyon/

function kindOf(desc: string, amount: number): LineKind {
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) ? 'payment' : 'refund'
  if (FEE_RE.test(f) && !f.includes('*')) return 'fee'
  return 'purchase'
}

interface Raw { date: string; desc: string; amount: number; bonus: number | null; inst: { index: number; count: number; total: number } | null }

export function parseKuveytCard(pages: PdfPage[]): ParsedStatement | null {
  if (!pages.length || !isKuveyt(pages)) return null
  const allLines = pages.flatMap(p => p.lines)

  const statementDate = isoOf(labelValue(allLines, 'Hesap Kesim Tarihi') ?? '')
  if (!statementDate) throw new Error('Kuveyt Türk ekstresinde hesap kesim tarihi okunamadı.')
  const dueDate = isoOf(labelValue(allLines, 'Son Ödeme Tarihi') ?? '')
  const nextStatementDate = isoOf(labelValue(allLines, 'Sonraki Hesap Kesim Tarihi') ?? '')
  const nextDueDate = isoOf(labelValue(allLines, 'Sonraki Son Ödeme Tarihi') ?? '')
  const debtLabel = labelValue(allLines, 'Dönem Borcunuz')
  const minLabel = labelValue(allLines, 'Asgari Ödeme Tutarı')
  const debt = debtLabel && TL_RE.test(debtLabel) ? trAmount(debtLabel) : null
  const card = allLines.map(l => l.text.match(MASK_RE)?.[1]).find(Boolean)

  // Özet: "Devreden Bakiye | Dönem Harcamaları | Ödemeleriniz | Dönem Borcunuz"
  // başlığının altındaki dört tutar (aralarındaki + − = ayrı parçalar)
  let summary: StatementSummary | null = null
  const hi = allLines.findIndex(l => foldText(l.text).includes('devreden bakiye') && foldText(l.text).includes('donem harcamalari'))
  if (hi >= 0) {
    const amountsOf = (l: PdfLine) => l.items.filter(i => /^[\d.]+,\d{2}$/.test(i.str.trim())).sort((a, b) => a.x - b.x).map(i => trAmount(i.str))
    const nums = allLines.slice(hi + 1, hi + 4).map(amountsOf).find(n => n.length >= 4) ?? []
    if (nums.length >= 4) {
      summary = { previous: nums[0], spending: nums[1], fees: 0, payments: nums[2], debt: nums[3], minPayment: minLabel && TL_RE.test(minLabel) ? trAmount(minLabel) : null }
    }
  }

  // ── İşlem tablosu ──
  const raw: Raw[] = []
  for (const page of pages) {
    let tutarX: number | null = null
    let descX = 0
    let puanRight = Infinity
    for (const line of page.lines) {
      const items = line.items.map(i => ({ ...i, str: i.str.trim() })).filter(i => i.str)
      const lt = foldText(line.text)
      if (lt.startsWith('islem tarihi') && lt.includes('tutar')) {
        tutarX = items.find(i => foldText(i.str) === 'tutar')!.x
        descX = items.find(i => foldText(i.str) === 'islem aciklamasi')?.x ?? 90
        puanRight = Math.max(...items.filter(i => /puan/.test(foldText(i.str))).map(i => i.right), tutarX + 60)
        continue
      }
      if (tutarX === null) continue
      if (lt.includes('devreden bakiye')) { tutarX = null; continue }   // tablo bitti, özet başladı
      const date = items[0] ? isoOf(items[0].str) : null
      if (!date) continue
      const amountItem = items.find(i => TL_RE.test(i.str) && i.right > tutarX! && i.x > tutarX! - 15)
      if (!amountItem) continue
      const puanItem = items.find(i => i !== amountItem && /^-?[\d,.]+$/.test(i.str) && i.x > amountItem.right && i.right <= puanRight + 10)
      const instItem = items.find(i => INST_RE.test(i.str))
      const im = instItem?.str.match(INST_RE)
      const parts = items.filter(i => i !== items[0] && i !== amountItem && i !== instItem && i !== puanItem && i.x >= descX - 3).map(i => i.str)
      if (parts.length > 1 && COUNTRY_RE.test(parts[parts.length - 1])) {
        parts.pop()
        if (parts.length > 1 && /^[\p{Lu}İ .\/-]+$/u.test(parts[parts.length - 1])) parts.pop()
      }
      const desc = parts.join(' ').replace(/^Taksit\s*-\s*/i, '').replace(/\s+/g, ' ').trim()
      const bonusVal = puanItem ? Number(puanItem.str.replace(/,/g, '')) : 0
      const inst = im ? { total: trAmount(im[1]), index: Number(im[2]), count: Number(im[3]) } : null
      raw.push({
        date: inst ? addMonths(date, inst.index - 1) : date,
        desc,
        amount: trAmount(amountItem.str),
        bonus: bonusVal ? bonusVal : null,
        inst: inst && inst.index <= inst.count ? inst : null,
      })
    }
  }

  const lines: StatementLine[] = []
  if (summary && summary.previous !== 0) {
    lines.push({ index: 0, date: null, description: 'Önceki dönem bakiyesi', amount: summary.previous, bonus: null, installment: null, foreign: null, kind: 'carry' })
  }
  for (const r of raw) {
    lines.push({
      index: lines.length, date: r.date, description: r.desc, amount: r.amount, bonus: r.bonus,
      installment: r.inst, foreign: null, kind: kindOf(r.desc, r.amount),
    })
  }

  // ── Kontrol: devir + satırlar = dönem borcu ──
  const issues: string[] = []
  const expected = summary?.debt ?? debt
  const computedMinor = lines.reduce((s, l) => s + toMinor(l.amount!), 0)
  const computed = toMajor(computedMinor)
  if (expected === null) issues.push('Ekstrede dönem borcu okunamadı; toplam kontrol edilemedi.')
  if (!summary) issues.push('Ekstre özeti (devreden bakiye) okunamadı; devir eklenemedi.')
  const diff = expected === null ? NaN : toMajor(computedMinor - toMinor(expected))
  if (expected !== null && diff !== 0) {
    issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) dönem borcunu (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  }
  if (summary && debt !== null && toMinor(summary.debt) !== toMinor(debt)) issues.push('Özetteki dönem borcu üst bilgidekiyle aynı değil.')
  if (summary) {
    const s = toMinor(summary.previous) + toMinor(summary.spending) - toMinor(summary.payments)
    if (s !== toMinor(summary.debt)) issues.push('Ekstre özetindeki rakamlar kendi içinde tutmuyor.')
  }
  if (!lines.some(l => l.kind !== 'carry')) issues.push('Ekstrede işlem satırı bulunamadı.')

  return {
    bank: 'kuveyt',
    bankLabel: 'Kuveyt Türk',
    type: 'credit_card',
    currency: 'TRY',
    cards: card ? [card] : [],
    statementDate,
    dueDate,
    prevStatementDate: null,
    nextStatementDate,
    nextDueDate,
    summary,
    lines,
    check: { ok: issues.length === 0, computed, expected: expected ?? NaN, diff, issues },
  }
}
