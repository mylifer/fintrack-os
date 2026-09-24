import { describe, it, expect } from 'vitest'
import {
  suggestCategoryIcon, normalizeCategoryName, isPlaceholderIcon, autoIconPatch,
} from './category-icon-suggest'
import { DEFAULT_CATEGORIES } from '@/types'

describe('normalizeCategoryName', () => {
  it('Türkçe büyük harfleri doğru küçültür (I→ı→i, İ→i)', () => {
    expect(normalizeCategoryName('İNTERNET')).toBe('internet')
    expect(normalizeCategoryName('ISINMA')).toBe('isinma')
    expect(normalizeCategoryName('Kişisel Bakım')).toBe('kisisel bakim')
    expect(normalizeCategoryName('Eğlence & Hobi')).toBe('eglence hobi')
  })
})

describe('suggestCategoryIcon', () => {
  const cases: Array<[string, string]> = [
    ['Market',           'shopping-cart'],
    ['Migros',           'shopping-cart'],
    ['Kahve',            'coffee'],
    ['Yemek',            'tools-kitchen-2'],
    ['Benzin',           'gas-station'],
    ['Otopark',          'parking'],
    ['Kira',             'key'],
    ['Elektrik Faturası','bolt'],
    ['İnternet',         'wifi'],
    ['Netflix',          'movie'],
    ['Spor Salonu',      'barbell'],
    ['Eczane',           'pill'],
    ['Kuaför',           'scissors'],
    ['Evcil Hayvan',     'paw'],
    ['Kargo',            'truck-delivery'],
    ['Bağış',            'heart-handshake'],
    ['Üniversite',       'school'],
    ['Kripto',           'currency-bitcoin'],
  ]
  it.each(cases)('%s → %s', (name, icon) => {
    expect(suggestCategoryIcon(name).icon).toBe(icon)
  })

  it('daha uzun/özel anahtar kelime kısasını yener', () => {
    // "kredi karti" > "kart" ve > "kredi"
    expect(suggestCategoryIcon('Kredi Kartı').icon).toBe('credit-card')
    expect(suggestCategoryIcon('Kredi').icon).toBe('report-money')
    // "kira geliri" > "kira"
    expect(suggestCategoryIcon('Kira Geliri', 'income').icon).toBe('home')
    expect(suggestCategoryIcon('Kira').icon).toBe('key')
  })

  it('Türkçe çekim eklerini önek eşleşmesiyle yakalar', () => {
    expect(suggestCategoryIcon('Marketler').icon).toBe('shopping-cart')
    expect(suggestCategoryIcon('Faturalarım').icon).toBe('receipt')
    expect(suggestCategoryIcon('Yemekler').icon).toBe('tools-kitchen-2')
  })

  it('kısa kökler daha uzun sözcüklere yapışmaz', () => {
    // "ev" kökü "evcil"e, "su" kökü "susi"ye takılmamalı
    expect(suggestCategoryIcon('Evcil Hayvan').icon).toBe('paw')
    expect(suggestCategoryIcon('Suşi').icon).toBe('fish')
  })

  it('eşleşme yoksa da renk seçer ve aynı isme hep aynı rengi verir', () => {
    const a = suggestCategoryIcon('Zırıltı Mırıltı')
    const b = suggestCategoryIcon('Zırıltı Mırıltı')
    expect(a.matched).toBe(false)
    expect(a.color).toBe(b.color)
    expect(a.color).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('eşleşmeyen gelir kategorisi gelir rengini alır', () => {
    const s = suggestCategoryIcon('Zırıltı Mırıltı', 'income')
    expect(s.icon).toBe('moneybag')
    expect(s.color).toBe('#10B981')
  })

  it('boş isimde varsayılana düşer', () => {
    expect(suggestCategoryIcon('  ')).toEqual({ icon: 'package', color: '#6366F1', matched: false })
  })

  /* Sistem kategorileri elle küratörlenmiş; öneri motoru onların büyük
     çoğunluğunda aynı ikonu bulmalı — bulamıyorsa tablo bir yerde kopuk. */
  it('varsayılan kategorilerin çoğunda küratörlü ikonla aynı sonucu verir', () => {
    const hits = DEFAULT_CATEGORIES.filter(d => suggestCategoryIcon(d.name, d.scope).icon === d.icon)
    expect(hits.length / DEFAULT_CATEGORIES.length).toBeGreaterThan(0.7)
  })
})

describe('isPlaceholderIcon', () => {
  it('varsayılan / legacy biçimleri yer tutucu sayar', () => {
    expect(isPlaceholderIcon('package')).toBe(true)
    expect(isPlaceholderIcon('')).toBe(true)
    expect(isPlaceholderIcon('noto:money-bag')).toBe(true)
    expect(isPlaceholderIcon('ShoppingCart')).toBe(true)   // Lucide PascalCase
    expect(isPlaceholderIcon('🛒')).toBe(true)
    expect(isPlaceholderIcon('shopping-cart')).toBe(false)
  })
})

describe('autoIconPatch', () => {
  const cat = (o: Partial<Parameters<typeof autoIconPatch>[0]>) =>
    ({ name: 'Market', icon: 'package', color: '#6366F1', scope: 'expense' as const, ...o })

  it('yer tutucu ikonu ikon+renkle birlikte günceller', () => {
    expect(autoIconPatch(cat({}))).toEqual({ icon: 'shopping-cart', color: '#10B981' })
  })

  it('ikon anlamlıysa ama renk hiç değiştirilmemişse yalnızca rengi düzeltir', () => {
    expect(autoIconPatch(cat({ icon: 'basket' }))).toEqual({ color: '#10B981' })
  })

  it('hem ikon hem renk özelleştirilmişse dokunmaz', () => {
    expect(autoIconPatch(cat({ icon: 'basket', color: '#FF0000' }))).toBeNull()
  })

  it('anahtar kelime eşleşmeyen isimlerde var olan veriye dokunmaz', () => {
    expect(autoIconPatch(cat({ name: 'Zırıltı Mırıltı' }))).toBeNull()
  })

  it('zaten doğru olan kategoride gereksiz yama üretmez', () => {
    expect(autoIconPatch(cat({ icon: 'shopping-cart', color: '#10B981' }))).toBeNull()
  })
})
