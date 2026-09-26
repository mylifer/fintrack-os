import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin, PIN_PATTERN } from './app-lock'

describe('uygulama kilidi — PIN özeti', () => {
  it('doğru PIN doğrulanır, yanlış reddedilir; tuz her seferinde farklı', async () => {
    const a = await hashPin('482915')
    const b = await hashPin('482915')
    expect(a.hash).not.toBe('482915')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPin('482915', a.hash, a.salt)).toBe(true)
    expect(await verifyPin('482916', a.hash, a.salt)).toBe(false)
  })

  it('PIN biçimi: 4–8 rakam', () => {
    expect(PIN_PATTERN.test('1234')).toBe(true)
    expect(PIN_PATTERN.test('12345678')).toBe(true)
    expect(PIN_PATTERN.test('123')).toBe(false)
    expect(PIN_PATTERN.test('12a4')).toBe(false)
  })
})
