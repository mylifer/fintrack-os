import { describe, it, expect } from 'vitest'
import { FUND_TAX_OFF, clampRate, fundTaxRate, holdingTax, portfolioTax, taxOnGain } from './fund-tax'
import type { InvestmentAsset } from '@/types'

const cfg = (o: Partial<typeof FUND_TAX_OFF> = {}) => ({ ...FUND_TAX_OFF, enabled: true, ...o })
const h = (asset: InvestmentAsset, pnl: number) => ({ asset, pnl })

describe('fundTaxRate', () => {
  it('ayar kapalıyken her varlıkta 0 — mevcut tutarlar değişmez', () => {
    expect(fundTaxRate('TEFAS:AFA', { ...FUND_TAX_OFF, defaultRate: 17.5 })).toBe(0)
  })

  it('yalnız TEFAS fonlarına uygulanır; altın/döviz kapsam dışı', () => {
    const c = cfg({ defaultRate: 17.5 })
    expect(fundTaxRate('TEFAS:AFA', c)).toBe(17.5)
    expect(fundTaxRate('GOLD_GRAM', c)).toBe(0)
    expect(fundTaxRate('USD', c)).toBe(0)
  })

  it('fon bazındaki oran varsayılanı EZER; 0 "istisna" demektir', () => {
    const c = cfg({ defaultRate: 17.5, rates: { TI2: 10, HSF: 0 } })
    expect(fundTaxRate('TEFAS:TI2', c)).toBe(10)
    // 0 sessizce varsayılana düşmemeli (?? değil || kullanılsaydı düşerdi)
    expect(fundTaxRate('TEFAS:HSF', c)).toBe(0)
    expect(fundTaxRate('TEFAS:AFA', c)).toBe(17.5)
  })

  it('oran %0–100 aralığına kırpılır', () => {
    expect(clampRate(-5)).toBe(0)
    expect(clampRate(140)).toBe(100)
    expect(clampRate(NaN)).toBe(0)
  })
})

describe('taxOnGain', () => {
  it('kâr üzerinden kuruşa yuvarlanır', () => {
    expect(taxOnGain(1000, 17.5)).toBe(175)
    expect(taxOnGain(333.33, 10)).toBe(33.33)
  })

  it('zararda ve sıfır oranda vergi yok — negatif vergi asla üretilmez', () => {
    expect(taxOnGain(-1000, 17.5)).toBe(0)
    expect(taxOnGain(0, 17.5)).toBe(0)
    expect(taxOnGain(1000, 0)).toBe(0)
  })
})

describe('portfolioTax', () => {
  it('matrah fon BAZINDA: zarardaki fon kârdakini mahsup etmez', () => {
    const c = cfg({ defaultRate: 20 })
    const rows = [h('TEFAS:AFA', 1000), h('TEFAS:TI2', -800)]
    // Mahsup olsaydı matrah 200 → 40 ₺ olurdu; muhafazakâr model 1000 → 200 ₺
    expect(portfolioTax(rows, c)).toBe(200)
  })

  it('fon dışı varlıklar toplama girmez', () => {
    const c = cfg({ defaultRate: 20 })
    expect(portfolioTax([h('GOLD_GRAM', 5000), h('USD', 2000)], c)).toBe(0)
  })

  it('kapalıyken toplam 0', () => {
    expect(portfolioTax([h('TEFAS:AFA', 1000)], FUND_TAX_OFF)).toBe(0)
  })

  it('holdingTax tek pozisyon için aynı sonucu verir', () => {
    const c = cfg({ defaultRate: 17.5 })
    expect(holdingTax(h('TEFAS:AFA', 1000), c)).toBe(175)
  })
})
