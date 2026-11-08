import { describe, it, expect } from 'vitest'
import { getBrandDomain } from './brands'

describe('getBrandDomain — kelime sınırı', () => {
  it('gerçek marka adlarını eşler', () => {
    expect(getBrandDomain('GETIR')).toBe('getir.com')
    expect(getBrandDomain('Getir Yemek')).toBe('getir.com')
    expect(getBrandDomain('IYZICO*GETIR')).toBe('getir.com')
    expect(getBrandDomain('UBER EATS')).toBe('ubereats.com')
    expect(getBrandDomain('Uber *Trip')).toBe('uber.com')
    expect(getBrandDomain('THY')).toBe('turkishairlines.com')
    expect(getBrandDomain('TURK HAVA YOLLARI')).toBe('turkishairlines.com')
    expect(getBrandDomain('Türk Hava Yolları')).toBe('turkishairlines.com')
    expect(getBrandDomain('ZARA HOME')).toBe('zara.com')
    expect(getBrandDomain('Canva Pro')).toBe('canva.com')
    expect(getBrandDomain('ŞOK Market')).toBe('sokmarket.com.tr')
    expect(getBrandDomain('N11.com')).toBe('n11.com')
  })

  it('isim/sözcük içindeki marka parçalarını eşlemez', () => {
    expect(getBrandDomain('Kathy')).toBeNull()
    expect(getBrandDomain('Hubert')).toBeNull()
    expect(getBrandDomain('Zarar')).toBeNull()
    expect(getBrandDomain('Ekmek getir')).toBeNull()
    expect(getBrandDomain('Canvas')).toBeNull()
    expect(getBrandDomain('Şokella')).toBeNull()
    expect(getBrandDomain('Mangosteen')).toBeNull()
  })
})
