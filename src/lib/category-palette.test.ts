import { describe, it, expect } from 'vitest'
import { COLOR_PALETTE, COLOR_PALETTE_GROUPS, SUGGEST_PALETTE } from './category-palette'
import { DEFAULT_CATEGORIES } from '@/types'

/* WCAG göreli parlaklığı → beyazla kontrast oranı. İkon rengin üstüne beyaz
   çizildiği için paletteki hiçbir ton beyazı okunmaz hale getirmemeli. */
function contrastWithWhite(hex: string): number {
  const lin = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5)
  return 1.05 / (L + 0.05)
}

describe('kategori renk paleti', () => {
  it('renkler büyük harfli #RRGGBB ve tekrarsız', () => {
    for (const c of COLOR_PALETTE) expect(c).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(COLOR_PALETTE).size).toBe(COLOR_PALETTE.length)
  })

  it('her grup 10\'luk satırlara tam oturur', () => {
    for (const g of COLOR_PALETTE_GROUPS) expect(g.colors.length % 10).toBe(0)
  })

  it('öneri yedeği ve varsayılan kategorilerin renkleri seçicide seçili görünür', () => {
    for (const c of SUGGEST_PALETTE) expect(COLOR_PALETTE).toContain(c)
    for (const d of DEFAULT_CATEGORIES) expect(COLOR_PALETTE).toContain(d.color.toUpperCase())
  })

  it('hiçbir ton beyaz ikonu en zayıf özgün renkten (sarı #EAB308) daha okunmaz yapmaz', () => {
    const floor = contrastWithWhite('#EAB308')
    for (const c of COLOR_PALETTE) expect(contrastWithWhite(c), c).toBeGreaterThanOrEqual(floor)
  })
})
