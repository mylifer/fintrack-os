import { describe, it, expect } from 'vitest'
import { brandOf, merchantCore, nameScore, sameCore, SURE, MAYBE } from './merchant-match'

describe('işyeri çekirdeği', () => {
  it('aracı, şehir (bitişik dahil), ülke kodu ve taksit eki atılır', () => {
    expect(merchantCore('YEMEKSEPETIPAY/YEMEKSEPISTANBUL').tokens).toEqual(['yemeksep'])
    expect(merchantCore('YEMEKSEPETIPAY/YEMEKSEPISTANBUL').gateway).toBe('yemeksepetipay')
    expect(merchantCore('MONEYPAY/MIGROSONE ISTANBUL TR').tokens).toEqual(['migrosone'])
    expect(merchantCore('OZEL DURU VETERINERL ISTANBUL TR').tokens).toEqual(['ozel', 'duru', 'veterinerl'])
    expect(merchantCore('ISTANBUL POSVITAL VETERISTANBUL TU').tokens).toEqual(['posvital', 'veter'])
    expect(merchantCore('BEYMEN PERAKENDE VE TEKST (3/6)').tokens).toEqual(['beymen', 'perakende', 've', 'tekst'])
    expect(merchantCore('IYZICO    *AMAZON.COM.T (1/6)').tokens).toEqual(['amazon'])
    expect(merchantCore('Google YouTubePremium London GBGB').tokens).toEqual(['google', 'youtubepremium'])
  })
  it('marka: ilk ayırt edici kelime', () => {
    expect(brandOf('IKEA-KARTAL MAĞAZASI')).toBe('ikea')
    expect(brandOf('IKEA-ÜMRANIYE MAĞAZA (3/3)')).toBe('ikea')
    expect(brandOf('ÖZEL DURU VETERİNERL')).toBe('duru')
    expect(brandOf('HEPSİPAY-HEP*HEPSİBURADA')).toBe('hepsiburada')
  })
  it('bankadan bankaya yazım farkı aynı işyeri sayılır', () => {
    expect(sameCore('ÖZEL DURU VETERİNERL', 'OZEL DURU VETERINERL ISTANBUL TR')).toBe(true)
    expect(sameCore('OZEL DURU VETERINERL', 'OZEL DURU VETERINERLIK KLINIGI')).toBe(true)
    expect(sameCore('IKEA-KARTAL MAĞAZASI', 'IKEA-ÜMRANIYE MAĞAZA')).toBe(false)
  })
})

describe('alıcı adı benzerliği', () => {
  const sure = (name: string, text: string) => expect(nameScore(name, text), `${name} ~ ${text}`).toBeGreaterThanOrEqual(SURE)
  const maybe = (name: string, text: string) => {
    const s = nameScore(name, text)
    expect(s, `${name} ~ ${text}`).toBeGreaterThanOrEqual(MAYBE)
    expect(s, `${name} ~ ${text}`).toBeLessThan(SURE)
  }
  const no = (name: string, text: string) => expect(nameScore(name, text), `${name} ~ ${text}`).toBeLessThan(MAYBE)

  it('kesik, bitişik ve aracılı yazımlar tanınır', () => {
    sure('Özel Duru Veteriner', 'OZEL DURU VETERINERL ISTANBUL TR')
    sure('Yemeksepeti', 'YEMEKSEPETIPAY/YEMEKSEPISTANBUL')
    sure('Yemeksepeti', 'YEMEK SEPETI')
    sure('Migros', 'MONEYPAY/MIGROSONE ISTANBUL TR')
    sure('Migros', 'MİGROS- ETHEMEFENDİ MİGRO')
    sure('IKEA', 'IKEA-KARTAL MAĞAZASI')
    sure('Hepsiburada', 'HEPSİPAY-HEP*HEPSİBURADA')
    sure('Amazon', 'IYZICO *AMAZON.COM.T')
    sure('Beymen', 'BEYMEN PERAKENDE VE TEKST (3/6)')
    sure('Kahve Dünyası', 'KAHVE DUNYASI SUADIYE KISTANBUL')
    sure('LC Waikiki', 'LCWAİKİKİ İSTANBUL KOZZY')
    sure('Posvital Veteriner', 'ISTANBUL POSVITAL VETERISTANBUL TU')
  })
  it('küçük yazım farkı öneri olarak sunulur', () => {
    maybe('Hepsiburda', 'HEPSİPAY-HEP*HEPSİBURADA')
  })
  it('rastlantısal benzerlik eşleşmez', () => {
    no('Aksi', 'BITAKSI 34 TR')
    no('Market', 'ERENKÖY EKMEK MARKET')
    no('Duru', 'DÜRÜMLE ISTANBUL')
    no('IKEA', 'NAZLIM ECZANESİ')
    no('Migros', 'MİGRAN KUAFÖR')
    no('Özel Duru Veteriner', 'VET HAST UNIVERSAL FATIH')
    no('Eczane', 'NAZLIM ECZANESİ')
    no('Universal Veteriner', 'VET HAST UNİVERSAL FATİH')
  })
})
