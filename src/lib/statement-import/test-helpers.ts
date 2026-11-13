import { expect } from 'vitest'
import type { PdfPage } from './pdf-text'
import type { ParsedStatement } from './statement'

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
