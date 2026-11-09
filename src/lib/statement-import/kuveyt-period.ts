import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { OcrLine, OcrPage } from './ocr'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Kuveyt Türk "Dönem İçi Harcamalar" ekran görüntüsü (OCR) ───────────────
   Mobil uygulama dönem içi işlemleri yalnız ekranda gösterir; ekran görüntüsü
   ocr.ts ile okunur. Ekran:
     Sağlam Kart Mastercard · 5188 •••• •••• 0734
     TL Harcamalar 11.250,00 · Bu Döneme Ait Taksitler 0,00 · Toplam 11.250,00 TL
     08.11.2026 23:22            3.750,00 TL     ← saatli satır: bekleyen (provizyon)
     VET HAST UNIVERSAL FATİH
     ISTANBUL TR                                  ← şehir · ülke (açıklamaya katılmaz)
     02.11.2026                 +249,07 TL      ← "+" (yeşil): kart ödemesi / iade

   OCR'ın bilinen yanılgıları tolere edilir: "+" → "*", "TL" → "1L"; sağ
   kenardaki simgeler (fiş, saat) kelime konumundan ayıklanır.
   Kontrol: harcamaların toplamı ekrandaki "TL Harcamalar" (ya da "Toplam")
   tutarını tutmalı — tutmazsa bir tutar yanlış okunmuştur. */

const DATE_RE = /^(\d{2})[./](\d{2})[./](\d{4})$/
const AMOUNT_RE = /^([*+-]?)(\d{1,3}(?:\.\d{3})*,\d{2})/

function isoOf(s: string): string | null {
  const m = s.trim().match(DATE_RE)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

const num = (s: string) => toMajor(toMinor(Number(s.replace(/\./g, '').replace(',', '.'))))

/** Satırın sağ yarısındaki tutar: "*1.100,93 TL" / "3.750,001L" → { credit, value } */
function amountIn(line: OcrLine, width: number): { credit: boolean; value: number } | null {
  const right = line.words.filter(w => w.x0 > width * 0.5).map(w => w.text).join('')
  const m = right.match(AMOUNT_RE)
  if (!m) return null
  return { credit: m[1] === '+' || m[1] === '*', value: num(m[2]) }
}

/** "TL Harcamalar 11.250,00" gibi etiketli özet tutarı */
function labelAmount(lines: OcrLine[], width: number, label: string): number | null {
  const l = lines.find(x => foldText(x.text).startsWith(label))
  return l ? amountIn(l, width)?.value ?? null : null
}

function kindOf(desc: string, credit: boolean): LineKind {
  if (!credit) return 'purchase'
  return /odeme|tahsilat/.test(foldText(desc)) ? 'payment' : 'refund'
}

export function parseKuveytScreenshot(page: OcrPage): ParsedStatement | null {
  const { lines, width } = page
  const folded = lines.map(l => foldText(l.text))
  if (!folded.some(t => t.includes('donem ici harcamalar')) || !folded.some(t => t.startsWith('tl harcamalar'))) return null

  const cardLine = lines.find(l => /^\d{4}\b/.test(l.text) && /\b\d{4}$/.test(l.text) && l.words.length >= 2)
  const card = cardLine?.text.match(/(\d{4})$/)?.[1]
  const spendTotal = labelAmount(lines, width, 'tl harcamalar')
  const grandTotal = labelAmount(lines, width, 'toplam')

  // Açıklama satırı en fazla bu kadar aşağıda olabilir (alt menü ayrılsın)
  const maxGap = width * 0.15
  const raw: { date: string; desc: string; amount: number; credit: boolean }[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const date = l.words[0] ? isoOf(l.words[0].text) : null
    if (!date) continue
    const amount = amountIn(l, width)
    if (!amount || amount.value === 0) continue
    const descLines: string[] = []
    for (let j = i + 1; j < lines.length && descLines.length < 3; j++) {
      const n = lines[j]
      if (n.y - l.y > maxGap || (n.words[0] && isoOf(n.words[0].text))) break
      // Sağ kenardaki simgeler ve baştaki simge/işaretler açıklamaya katılmaz
      const words = n.words.filter(w => w.x1 < width * 0.85).map(w => w.text)
      while (words.length && !/[\p{L}\d]/u.test(words[0])) words.shift()
      if (words.length) descLines.push(words.join(' '))
    }
    // Son satır "ISTANBUL TR" gibi şehir · ülke ise atılır
    if (descLines.length > 1 && /^[\p{Lu}İ .-]+ [A-Z]{2}$/u.test(descLines[descLines.length - 1])) descLines.pop()
    const desc = descLines.join(' ').replace(/\s+/g, ' ').trim()
    raw.push({ date, desc, amount: amount.credit ? -amount.value : amount.value, credit: amount.credit })
  }
  raw.sort((a, b) => a.date.localeCompare(b.date))

  const out: StatementLine[] = raw.map((r, index) => ({
    index, date: r.date, description: r.desc || 'Kart işlemi', amount: r.amount, bonus: null, installment: null, foreign: null,
    kind: kindOf(r.desc, r.credit),
  }))

  const spentMinor = out.reduce((s, l) => s + (l.amount! > 0 ? toMinor(l.amount!) : 0), 0)
  const spent = toMajor(spentMinor)
  const issues: string[] = []
  if (!out.length) issues.push('Ekran görüntüsünde işlem satırı bulunamadı.')
  const totals = [spendTotal, grandTotal].filter((t): t is number => t !== null)
  const expected = totals.find(t => toMinor(t) === spentMinor) ?? totals[0] ?? null
  if (expected === null) issues.push('Ekrandaki "TL Harcamalar" tutarı okunamadı; tutarlar kontrol edilemedi.')
  const diff = expected === null ? 0 : toMajor(spentMinor - toMinor(expected))
  if (diff !== 0) {
    issues.push(`Okunan harcamaların toplamı (${spent.toFixed(2)}) ekrandaki toplamı (${expected!.toFixed(2)}) tutmuyor: bir tutar yanlış okunmuş ya da ekranın tamamı görüntüde yok.`)
  }

  const asOf = raw.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null)
  if (!asOf) throw new Error('Ekran görüntüsünde tarih okunamadı.')

  return {
    bank: 'kuveyt', bankLabel: 'Kuveyt Türk', type: 'credit_card', currency: 'TRY', cards: card ? [card] : [],
    statementDate: asOf, dueDate: null, prevStatementDate: null, nextStatementDate: null, nextDueDate: null, summary: null,
    lines: out,
    check: { ok: issues.length === 0, computed: spent, expected: expected ?? spent, diff, issues },
    provisional: true,
  }
}
