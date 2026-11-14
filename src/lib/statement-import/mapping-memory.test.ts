import { describe, it, expect, beforeEach } from 'vitest'
import { forgetMapping, loadMapping, rememberMapping } from './mapping-memory'
import type { ColumnMapping } from './column-map'

const m: ColumnMapping = {
  date: 0, description: 1, amountMode: 'single', amount: 2, debit: -1, credit: -1, balance: -1,
  dateFormat: 'dmy', decimal: 'comma', sign: 'expense-positive', statementType: 'credit_card',
}

beforeEach(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
  })
})

describe('eşleme hafızası', () => {
  it('imzaya göre saklar, getirir ve unutur', () => {
    expect(loadMapping('sheet:3:a|b|c')).toBeNull()
    rememberMapping('sheet:3:a|b|c', m, 'Örnek Bank', '2026-11-14T10:00:00Z')
    expect(loadMapping('sheet:3:a|b|c')).toEqual({ mapping: m, label: 'Örnek Bank', usedAt: '2026-11-14T10:00:00Z' })
    expect(loadMapping('sheet:3:x')).toBeNull()
    forgetMapping('sheet:3:a|b|c')
    expect(loadMapping('sheet:3:a|b|c')).toBeNull()
  })
  it('bozuk kayıt ya da erişilemeyen depo boş döner', () => {
    localStorage.setItem('fintrack:stmt-colmap', '{"k":{"mapping":{"date":"x"}}}')
    expect(loadMapping('k')).toBeNull()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('kapalı') } })
    expect(loadMapping('k')).toBeNull()
    expect(() => rememberMapping('k', m, '')).not.toThrow()
  })
})
