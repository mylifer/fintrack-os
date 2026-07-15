import { describe, it, expect } from 'vitest'
import { isTefasAsset, tefasCode, tefasAsset, tefasCodesIn, TEFAS_CODE_RE } from './tefas'
import { snapPeriod } from './server/tefas-api'

describe('tefas asset helpers', () => {
  it('round-trips fund codes through the asset string', () => {
    expect(tefasAsset('afa')).toBe('TEFAS:AFA')
    expect(tefasCode('TEFAS:AFA')).toBe('AFA')
    expect(isTefasAsset('TEFAS:AFA')).toBe(true)
    expect(isTefasAsset('GOLD_GRAM')).toBe(false)
    expect(tefasCode('USD')).toBe('')
  })

  it('collects distinct fund codes from a transaction list', () => {
    expect(tefasCodesIn(['TEFAS:AFA', 'USD', 'TEFAS:YAC', 'TEFAS:AFA'])).toEqual(['AFA', 'YAC'])
    expect(tefasCodesIn(['GOLD_GRAM', 'EUR'])).toEqual([])
  })

  it('accepts only 2-6 char alphanumeric codes', () => {
    expect(TEFAS_CODE_RE.test('AFA')).toBe(true)
    expect(TEFAS_CODE_RE.test('TI2')).toBe(true)
    expect(TEFAS_CODE_RE.test('A')).toBe(false)
    expect(TEFAS_CODE_RE.test('TOOLONGG')).toBe(false)
    expect(TEFAS_CODE_RE.test('af a')).toBe(false)
  })
})

describe('snapPeriod', () => {
  it('snaps look-back days to the periods the TEFAS API accepts', () => {
    expect(snapPeriod(0)).toBe(1)
    expect(snapPeriod(7)).toBe(3)   // +1 ay tampon: ay başı/tatil boşluğu seriden düşmesin
    expect(snapPeriod(45)).toBe(3)
    expect(snapPeriod(90)).toBe(6)
    expect(snapPeriod(365)).toBe(36)
    expect(snapPeriod(1095)).toBe(60)
    expect(snapPeriod(10_000)).toBe(60) // 5 yıldan eskisi yok — en genişe sabitlenir
  })
})
