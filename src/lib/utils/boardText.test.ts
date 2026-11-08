import { describe, it, expect } from 'vitest'
import { matchesTokens, tokenize } from './boardText'

describe('matchesTokens — Türkçe İ/ı duyarlı arama', () => {
  it('"internet" → "İnternet Faturası" bulunur', () => {
    expect(matchesTokens('İnternet Faturası', tokenize('internet'))).toBe(true)
    expect(matchesTokens('İnternet Faturası', tokenize('İNTERNET fat'))).toBe(true)
    expect(matchesTokens('Işık', tokenize('ışık'))).toBe(true)
  })

  it('tüm parçalar eşleşmeli; boş sorgu her şeyi eşler', () => {
    expect(matchesTokens('İnternet Faturası', tokenize('internet su'))).toBe(false)
    expect(matchesTokens('Market', tokenize('   '))).toBe(true)
  })
})
