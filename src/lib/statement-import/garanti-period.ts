import { foldText } from '@/lib/auto-category'
import { toMajor, toMinor } from '@/lib/utils/money'
import type { PdfItem, PdfPage } from './pdf-text'
import type { LineKind, ParsedStatement, StatementLine } from './statement'

/* ── Garanti BBVA "Dönemiçi İşlemler - TL" listesi (PDF) ────────────────────
   Ekstre kesilmeden internet şubesinden alınan liste. İki tablo:
     • Açık Provizyon İşlemler — henüz kesinleşmemiş harcamalar
     • Dönemiçi İşlemler       — dönem içinde hesaba geçenler
   Sütunlar: Tarih | İşlem | (şehir) | Etiket | Bonus | Tutar (TL)

   • İşaret ekstrenin tersidir: "-1.234,56" harcama, "1.234,56" / "+…" alacak.
   • Bonus sütunu (sağa yaslı, Tutar'ın solunda) kart borcunu etkilemez:
     "0,41" kazanılan, "-779,35" harcanan, "+285,00" kampanya bonusu.
   • Taksit açıklamada: "BEYMEN … (3/6)". Satır tarihi o taksidin tarihidir
     (alım + 2 ay); toplam tutar listede yok, taksit × adet ile tahmin edilir.
   • Kontrol: tabloların "Toplam … Tutarı" satırları okunan satırlarla tutmalı.
     Harcama toplamı kart ödemelerini ("BonusFlaş Ödeme") içermez, iadeleri içerir. */

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const AMOUNT_RE = /^[+-]?[\d.]+,\d{2}$/
const INST_RE = /\s*\((\d{1,2})\/(\d{1,2})\)\s*$/
const MASK_RE = /\d{4}\s?\*{4}\s?\*{4}\s?(\d{4})/
/** Sütun sağ kenarına yakınlık toleransı (pt). Bonus ile Tutar arası ~80 pt. */
const COL_TOLERANCE = 20

function isoOf(s: string): string | null {
  const m = s.trim().match(DATE_RE) ?? s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** "-1.234,56" → 1234.56 (işaret ayrı okunur) */
const amountOf = (s: string) => toMajor(toMinor(Number(s.replace(/^[+-]/, '').replace(/\./g, '').replace(',', '.'))))
const isNegative = (s: string) => s.trim().startsWith('-')

const PAYMENT_RE = /odemeniz icin tesekkur|odeme|tahsilat/
const FEE_RE = /faiz|bsmv|kkdf|ucret|aidat|komisyon/

function kindOf(desc: string, amount: number | null): LineKind {
  if (amount === null) return 'bonus'
  const f = foldText(desc)
  if (amount < 0) return PAYMENT_RE.test(f) && !f.includes('*') ? 'payment' : 'refund'
  if (FEE_RE.test(f) && !f.includes('*')) return 'fee'
  return 'purchase'
}

function isGarantiPeriod(pages: PdfPage[]): boolean {
  const text = foldText(pages.flatMap(p => p.lines.map(l => l.text)).join(' '))
  return text.includes('garanti') && text.includes('donemici islemler - tl') && text.includes('donem ici islem bilgileriniz')
}

interface Columns { descX: number; etiketX: number; bonusRight: number; tutarRight: number }

function headerColumns(items: PdfItem[]): Columns | null {
  const find = (label: string) => items.find(i => foldText(i.str.trim()) === label)
  const date = find('tarih'), desc = find('islem'), etiket = find('etiket'), bonus = find('bonus'), tutar = find('tutar (tl)')
  if (!date || !desc || !etiket || !bonus || !tutar) return null
  return { descX: desc.x, etiketX: etiket.x, bonusRight: bonus.right, tutarRight: tutar.right }
}

interface Raw { date: string; desc: string; amount: number | null; bonus: number | null; inst: { index: number; count: number } | null; label: string | null }

export function parseGarantiPeriod(pages: PdfPage[]): ParsedStatement | null {
  if (!pages.length || !isGarantiPeriod(pages)) return null
  const allLines = pages.flatMap(p => p.lines)
  const fullText = allLines.map(l => l.text).join(' ')

  const card = fullText.match(MASK_RE)?.[1]
  // Özet satırı: kart tipi · kart no · toplam · son hesap kesim · son ödeme
  const headDates = allLines.find(l => MASK_RE.test(l.text))?.items.map(i => isoOf(i.str)).filter((d): d is string => !!d) ?? []
  const prevStatementDate = headDates[0] ?? null

  const raw: Raw[] = []
  const totals: number[] = []
  let section: 'provision' | 'period' | null = null
  let provisionRows = 0
  // Sayfa başında başlık tekrarlanmayabilir: sütunlar sayfadan sayfaya taşınır
  let cols: Columns | null = null
  for (const page of pages) {
    for (const [li, line] of page.lines.entries()) {
      const items = line.items.map(i => ({ ...i, str: i.str.trim() })).filter(i => i.str)
      const lt = foldText(line.text)
      if (lt.startsWith('acik provizyon islemler')) { section = 'provision'; cols = null; continue }
      if (lt.startsWith('donemici islemler - tl') && items[0].x < 100) { section = 'period'; cols = null; continue }
      const h = headerColumns(items)
      if (h) { cols = h; continue }
      if (!cols || !section) continue
      const c = cols
      const tutarItem = items.find(i => AMOUNT_RE.test(i.str.replace(/\s*TL$/, '')) && Math.abs(i.right - c.tutarRight) <= COL_TOLERANCE)
      if (lt.startsWith('toplam')) {
        if (tutarItem) totals.push(amountOf(tutarItem.str.replace(/\s*TL$/, '')))
        cols = null
        continue
      }
      const date = items[0] ? isoOf(items[0].str) : null
      if (!date) continue
      const bonusItem = items.find(i => AMOUNT_RE.test(i.str) && Math.abs(i.right - c.bonusRight) <= COL_TOLERANCE)
      if (!tutarItem && !bonusItem) continue
      // Şehir sütunu (≈265 pt) açıklamaya katılmaz: açıklama ile etiket arasındaki son parça
      const descItems = items.filter(i => i !== items[0] && i.x >= c.descX - 3 && i.x < c.etiketX - 3)
      const city = descItems.length > 1 && /^[\p{Lu}İ ]+$/u.test(descItems[descItems.length - 1].str) && descItems[descItems.length - 1].x > c.descX + 150
      let desc = (city ? descItems.slice(0, -1) : descItems).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
      const im = desc.match(INST_RE)
      if (im) desc = desc.replace(INST_RE, '').trim()
      const amount = tutarItem ? (isNegative(tutarItem.str) ? 1 : -1) * amountOf(tutarItem.str) : null
      const bonus = bonusItem ? (isNegative(bonusItem.str) ? -1 : 1) * amountOf(bonusItem.str) : null
      if (amount === 0 && bonus === null) continue
      // Etiket (bankanın kategorisi) aynı satırda ya da iki satıra bölünmüş:
      // "Giyim /" bir üstte, "Aksesuar" bir altta
      const inLabel = (i: { x: number }) => i.x >= c.etiketX - 3 && i.x < c.etiketX + 60
      const labelOnly = (l?: typeof line) => {
        const its = l?.items.filter(i => i.str.trim()) ?? []
        return its.length && its.every(inLabel) ? its.map(i => i.str.trim()).join(' ') : null
      }
      let label = items.filter(i => i !== items[0] && inLabel(i) && !AMOUNT_RE.test(i.str)).map(i => i.str).join(' ') || null
      if (!label) {
        const above = labelOnly(page.lines[li - 1])
        if (above?.endsWith('/')) label = `${above} ${labelOnly(page.lines[li + 1]) ?? ''}`.trim()
      }
      raw.push({ date, desc, amount, bonus, inst: im ? { index: Number(im[1]), count: Number(im[2]) } : null, label: label?.replace(/\s*\/\s*/g, ' / ') ?? null })
      if (section === 'provision') provisionRows++
    }
  }

  // Ekstreyle aynı düzen: eskiden yeniye
  const order = raw.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || b.i - a.i)
  const lines: StatementLine[] = order.map(({ r }, index) => ({
    index,
    date: r.date,
    description: r.desc,
    amount: r.amount,
    bonus: r.bonus,
    installment: r.inst && r.amount !== null && r.inst.index <= r.inst.count
      ? { index: r.inst.index, count: r.inst.count, total: toMajor(toMinor(r.amount) * r.inst.count) }
      : null,
    foreign: null,
    kind: kindOf(r.desc, r.amount),
    bankCategory: r.label,
  }))

  // Liste tarihi: taksitler ileri tarihli olabilir, en yeni tek çekim/provizyon tarihi alınır
  const asOf = raw.filter(r => !r.inst).reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null)
    ?? raw.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null)
    ?? prevStatementDate
  if (!asOf) throw new Error('Garanti dönem içi işlem listesinde tarih okunamadı.')

  // "Toplam TL Harcama Tutarı" kart ödemelerini saymaz (iadeleri sayar): ödemeler kontrole girmez
  const computedMinor = lines.reduce((s, l) => s + (l.amount === null || l.kind === 'payment' ? 0 : toMinor(l.amount)), 0)
  const computed = toMajor(computedMinor)
  const issues: string[] = []
  const expectedCount = (provisionRows > 0 ? 1 : 0) + (raw.length > provisionRows ? 1 : 0)
  if (totals.length < expectedCount) issues.push('Listenin "Toplam" satırı okunamadı; toplam kontrol edilemedi.')
  const expected = totals.length ? toMajor(totals.reduce((s, t) => s + toMinor(t), 0)) : computed
  const diff = toMajor(computedMinor - toMinor(expected))
  if (diff !== 0) issues.push(`Okunan satırların toplamı (${computed.toFixed(2)}) listenin toplamını (${expected.toFixed(2)}) tutmuyor: fark ${diff.toFixed(2)}.`)
  if (!lines.length) issues.push('Listede işlem satırı bulunamadı.')

  return {
    bank: 'garanti',
    bankLabel: 'Garanti BBVA',
    type: 'credit_card',
    currency: 'TRY',
    cards: card ? [card] : [],
    statementDate: asOf,
    dueDate: null,
    prevStatementDate,
    nextStatementDate: null,
    nextDueDate: null,
    summary: null,
    lines,
    check: { ok: issues.length === 0, computed, expected, diff, issues },
    provisional: true,
  }
}
