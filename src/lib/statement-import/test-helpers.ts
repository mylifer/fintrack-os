import { expect } from 'vitest'
import type { PdfPage } from './pdf-text'
import { parseStatement, withDiffHint, type LineKind, type ParsedStatement, type StatementLine } from './statement'
import { toMajor, toMinor } from '@/lib/utils/money'
import { parseGarantiCard } from './garanti-card'
import { parseGarantiPeriod } from './garanti-period'
import { parseQnbPeriod, parseQnbStatement } from './qnb-card'
import { parseBurganCard } from './burgan-card'
import { parseYapiKrediCard } from './yapikredi-card'
import { parseOdeabankCard } from './odeabank-card'
import { parseOdeabankPeriod } from './odeabank-period'
import { parseOdeabankAccount } from './odeabank-account'
import { parseKuveytCard } from './kuveyt-card'

/** Sayfayı `text` içeren ilk satırdan önce ikiye böler; ikinci sayfaya tablo
 *  başlığı KOPYALANMAZ (bankalar tabloyu sayfa sınırında başlıksız sürdürebilir). */
export function splitBefore(pages: PdfPage[], text: string): PdfPage[] {
  for (let p = 0; p < pages.length; p++) {
    const i = pages[p].lines.findIndex(l => l.text.includes(text))
    if (i > 0) return [...pages.slice(0, p), { lines: pages[p].lines.slice(0, i) }, { lines: pages[p].lines.slice(i) }, ...pages.slice(p + 1)]
  }
  throw new Error(`splitBefore: "${text}" satırı bulunamadı`)
}

/** Tablo başlıksız bir sonraki sayfaya taşsa da okuma birebir aynı kalmalı. */
export function expectSameAcrossPageBreak(parse: (pages: PdfPage[]) => ParsedStatement | null, pages: PdfPage[], text: string) {
  const whole = parse(pages)!
  const split = parse(splitBefore(pages, text))!
  expect(whole.check.ok).toBe(true)
  expect(split.lines).toEqual(whole.lines)
  expect(split.check).toEqual(whole.check)
}

// ── Altın çıktı (golden.test.ts) ────────────────────────────────────────────

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toFixed(2))

/** Satırın tek satırlık, karşılaştırılabilir özeti: her alan sabit sırada. */
export function lineDigest(l: StatementLine): string {
  const inst = l.installment ? `${l.installment.index}/${l.installment.count}@${fmt(l.installment.total)}` : '—'
  const foreign = l.foreign ? `${fmt(l.foreign.amount)} ${l.foreign.currency}` : '—'
  const extra = [l.bankCategory ? `etiket=${l.bankCategory}` : '', l.time ? `saat=${l.time}` : '', l.balance !== undefined ? `bakiye=${fmt(l.balance)}` : ''].filter(Boolean).join(' ')
  return [l.index, l.date ?? '—', l.kind, fmt(l.amount), `bonus=${fmt(l.bonus)}`, `taksit=${inst}`, `döviz=${foreign}`, l.description, extra].join(' | ').trim()
}

export interface GoldenSummary {
  bank: ParsedStatement['bank']
  type: ParsedStatement['type']
  provisional: boolean
  statementDate: string
  dueDate: string | null
  cards: string[]
  check: { ok: boolean; computed: number; expected: number }
  count: number
  /** Tutarlı satırların toplamı (kuruş hassasiyetinde) */
  total: number
  /** Tür başına satır sayısı ve tutar toplamı */
  byKind: Partial<Record<LineKind, [number, number]>>
  first: string
  last: string
}

export function goldenSummary(st: ParsedStatement): GoldenSummary {
  const byKind: GoldenSummary['byKind'] = {}
  let total = 0
  for (const l of st.lines) {
    const k = byKind[l.kind] ?? [0, 0]
    byKind[l.kind] = [k[0] + 1, toMajor(toMinor(k[1]) + toMinor(l.amount ?? 0))]
    total += toMinor(l.amount ?? 0)
  }
  return {
    bank: st.bank, type: st.type, provisional: !!st.provisional, statementDate: st.statementDate, dueDate: st.dueDate, cards: st.cards,
    check: { ok: st.check.ok, computed: st.check.computed, expected: st.check.expected },
    count: st.lines.length, total: toMajor(total), byKind,
    first: lineDigest(st.lines[0]), last: lineDigest(st.lines[st.lines.length - 1]),
  }
}

/** Bütün PDF ayrıştırıcıları (statement.ts'teki sırayla değil, ada göre) */
export const PDF_PARSERS: Record<string, (pages: PdfPage[]) => ParsedStatement | null> = {
  parseGarantiCard, parseGarantiPeriod, parseQnbStatement, parseQnbPeriod, parseBurganCard, parseYapiKrediCard,
  parseOdeabankCard, parseOdeabankPeriod, parseOdeabankAccount, parseKuveytCard,
}

/** Örnek yalnız kendi ayrıştırıcısınca tanınmalı, dağıtıcı (parseStatement)
 *  aynı çıktıyı vermeli ve çıktı altın özetle (+ satır özetleri anlık
 *  görüntüsüyle) birebir aynı kalmalı. */
export function expectGolden(own: keyof typeof PDF_PARSERS, pages: PdfPage[], golden: GoldenSummary) {
  const st = PDF_PARSERS[own](pages)
  expect(st, `${own} örneği tanımadı`).not.toBeNull()
  for (const [name, parse] of Object.entries(PDF_PARSERS)) {
    if (name !== own) expect(parse(pages), `${name}, ${own} örneğini de tanıyor`).toBeNull()
  }
  expect(parseStatement(pages)).toEqual(withDiffHint(st!))
  expect(goldenSummary(st!)).toEqual(golden)
  expect(st!.lines.map(lineDigest)).toMatchSnapshot()
}
