import { describe, it, expect } from 'vitest'
import { formatCurrencyInputLive, parseCurrencyInput } from './currency'

/** Inputa tek tek yazmayı taklit eder: her tuşta maske önceki değerle çalışır. */
function typeChars(chars: string, start = ''): string {
  let v = start
  for (const ch of chars) v = formatCurrencyInputLive(v + ch, v)
  return v
}

/** Son karakteri silmeyi (Backspace) taklit eder. */
function backspace(v: string): string {
  return formatCurrencyInputLive(v.slice(0, -1), v)
}

const live = (raw: string) => parseCurrencyInput(formatCurrencyInputLive(raw))

describe('formatCurrencyInputLive — yapıştırma / tek seferde giriş', () => {
  it('nokta ondalıklı değerler ondalık kalır', () => {
    expect(formatCurrencyInputLive('1234.56')).toBe('1.234,56')
    expect(live('1234.56')).toBe(1234.56)
    expect(live('12.5')).toBe(12.5)
    expect(live('-1234.5')).toBe(-1234.5)
  })

  it('TR biçimi korunur', () => {
    expect(formatCurrencyInputLive('1.234')).toBe('1.234')
    expect(live('1.234')).toBe(1234)
    expect(formatCurrencyInputLive('1.234,56')).toBe('1.234,56')
    expect(live('1.234,56')).toBe(1234.56)
    expect(live('12.345.678')).toBe(12345678)
    expect(formatCurrencyInputLive('1234567')).toBe('1.234.567')
    expect(formatCurrencyInputLive('1234,567')).toBe('1.234,56')
  })
})

describe('formatCurrencyInputLive — canlı yazma', () => {
  it('rakamlar otomatik gruplanır', () => {
    expect(typeChars('1234567')).toBe('1.234.567')
    expect(typeChars('1234,56')).toBe('1.234,56')
  })

  it('"12.5" yazmak 12,5 olur (125 değil)', () => {
    expect(parseCurrencyInput(typeChars('12.5'))).toBe(12.5)
  })

  it('TR usulü elle noktalı yazım bozulmaz', () => {
    expect(typeChars('1.234')).toBe('1.234')
    expect(typeChars('1.234,56')).toBe('1.234,56')
    expect(parseCurrencyInput(typeChars('1.234,56'))).toBe(1234.56)
  })

  it('gruplu değerden silme binlik noktasını ondalığa çevirmez', () => {
    const v = typeChars('1234')        // "1.234"
    expect(v).toBe('1.234')
    expect(backspace(v)).toBe('123')
    expect(backspace(typeChars('12345'))).toBe('1.234')
  })

  it('nokta ondalıklı değerden silme ondalığı korur', () => {
    const v = typeChars('12.5')
    expect(formatCurrencyInputLive('1.5', v)).toBe('1.5')
    expect(parseCurrencyInput(formatCurrencyInputLive('1.5', v))).toBe(1.5)
  })

  it('eksi işareti korunur', () => {
    expect(typeChars('-1234')).toBe('-1.234')
    expect(formatCurrencyInputLive('-')).toBe('-')
  })
})
