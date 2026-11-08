import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Odeabank "Kredi Kartı Dönem İçi İşlemler" listesi (PDF) ────────────────
   Ekstre kesilmeden alınan liste. Tablo: Tarih | İşlem | Tutar
   • Tarih "2026-11-02"; tutar TR biçiminde, kuruşsuz olabilir: "-249 TL",
     "-3902,14 TL". İşaret ekstrenin tersidir: "−" harcama, "+" ödeme/iade.
   • Açıklama: işyeri · şehir · ülke; şehir ve ülke açıklamaya katılmaz.
   • Taksit bilgisi yok: taksit satırı tek çekim gibi görünür (eşleştirme,
     dönem içi listede sistemdeki taksit kaydına da bakar).
   • Kontrol: harcama satırlarının toplamı "Dönem İçi Toplam TL Harcama"yı
     tutmalı. "Toplam TL Ödeme" kontrol edilmez: banka önceki ekstre borcuna
     yapılan ödemeyi listeler ama bu toplama katmıyor. */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const AMOUNT_RE = /^([+-]?)([\d.]+(?:,\d{1,2})?)\s*TL$/
const MASK_RE = /\d{4}\*{8}(\d{4})/
const COUNTRY_RE = /^[A-Z]{2}$/

function isoOf(s: string): string | null {
  const m = s.trim().match(DATE_RE)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** "-3902,14 TL" → −3902.14 · ": 4151,14" → 4151.14 */
function trAmount(s: string): number | null {
  const t = s.trim().replace(/^:\s*/, '')
  const m = t.match(AMOUNT_RE) ?? `${t} TL`.match(AMOUNT_RE)
  if (!m) return null
  const v = toMajor(toMinor(Number(m[2].replace(/\./g, '').replace(',', '.'))))
  return m[1] === '-' ? -v : v
}

function kindOf(desc: string, amount: number): LineKind {
  if (amount >= 0) return 'purchase'
  return /odeme|tahsilat/.test(foldText(desc)) ? 'payment' : 'refund'
}

export function parseOdeabankPeriod(pages: PdfPage[]): ParsedStatement | null {
  if (!pages.length) return null
  const allLines = pages.flatMap(p => p.lines)
  const folded = foldText(allLines.map(l => l.text).join(' '))
  if (!folded.includes('kredi karti donem ici islemler') || !folded.includes('donem ici toplam tl harcama')) return null

  const card = allLines.map(l => l.text.match(MASK_RE)?.[1]).find(Boolean)
  // Değer etiketle aynı satırda ya da hemen üstünde (": 4151,14")
  const valueNear = (label: string) => {
    const i = allLines.findIndex(l => foldText(l.text).includes(label))
    for (const l of [allLines[i], allLines[i - 1], allLines[i + 1]]) {
      const v = l?.items.find(it => it.str.trim().startsWith(':'))
      if (v) { const n = trAmount(v.str); if (n !== null) return n }
    }
    return null
  }
  const spendTotal = valueNear('donem ici toplam tl harcama')

  const raw: { date: string; desc: string; amount: number }[] = []
  for (const page of pages) {
    let tutarRight: number | null = null
    let descX = 0
    for (const line of page.lines) {
      const items = line.items.map(i => ({ ...i, str: i.str.trim() })).filter(i => i.str)
      const tutar = items.find(i => foldText(i.str) === 'tutar')
      if (tutar && items.some(i => foldText(i.str) === 'tarih')) {
        tutarRight = tutar.right
        descX = (items.find(i => foldText(i.str) === 'islem')?.x ?? 0) - 5
        continue
      }
      if (tutarRight === null) continue
      const date = items[0] ? isoOf(items[0].str) : null
      if (!date) continue
      const amountItem = [...items].reverse().find(i => AMOUNT_RE.test(i.str))
      if (!amountItem) continue
      const signed = trAmount(amountItem.str)
      if (signed === null || signed === 0) continue
      const parts = items.filter(i => i !== items[0] && i !== amountItem && i.x >= descX).map(i => i.str)
      if (parts.length > 1 && COUNTRY_RE.test(parts[parts.length - 1])) {
        parts.pop()
        if (parts.length > 1 && /^[\p{Lu}İ .-]+$/u.test(parts[parts.length - 1])) parts.pop()
      }
      // Listede harcama "−": kart borcuna etkisi tersidir
      raw.push({ date, desc: parts.join(' ').replace(/\s+/g, ' ').trim(), amount: -signed })
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date))

  const lines: StatementLine[] = raw.map((r, index) => ({
    index, date: r.date, description: r.desc, amount: r.amount, bonus: null, installment: null, foreign: null,
    kind: kindOf(r.desc, r.amount),
  }))

  const spentMinor = lines.reduce((s, l) => s + (l.amount! > 0 ? toMinor(l.amount!) : 0), 0)
  const issues: string[] = []
  if (!lines.length) issues.push('Listede işlem satırı bulunamadı.')
  if (spendTotal === null) issues.push('Listenin "Dönem İçi Toplam TL Harcama" tutarı okunamadı; toplam kontrol edilemedi.')
  const diff = spendTotal === null ? 0 : toMajor(spentMinor - toMinor(spendTotal))
  if (diff !== 0) issues.push(`Okunan harcamaların toplamı (${toMajor(spentMinor).toFixed(2)}) listenin toplam harcamasını (${spendTotal!.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)

  const asOf = raw.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null)
  if (!asOf) throw new Error('Odeabank dönem içi işlem listesinde tarih okunamadı.')

  return {
    bank: 'odeabank', bankLabel: 'Odeabank', type: 'credit_card', currency: 'TRY', cards: card ? [card] : [],
    statementDate: asOf, dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null, lines,
    check: { ok: issues.length === 0, computed: toMajor(spentMinor), expected: spendTotal ?? toMajor(spentMinor), diff, issues },
    provisional: true,
  }
}
