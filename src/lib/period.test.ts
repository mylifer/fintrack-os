import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { getPeriodRangeAt, formatPeriodLabel, monthsBetween } from './utils/date'
import { allTimeRange, isDefaultSelection, periodSelectionLabel, periodSelectionMonth, resolvePeriodRange } from './period'
import { useUIStore } from '@/store/ui.store'

// 11 Kasım 2026, öğle — gün/ay sınırına yakın değil
const NOW = new Date(2026, 10, 11, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  useUIStore.setState({ periodType: 'monthly', periodOffset: 0, customRange: null })
})

describe('3 Aylık dönem', () => {
  it('referans ayla biten 3 aylık pencere', () => {
    expect(getPeriodRangeAt('quarterly', 0)).toEqual({ from: '2026-09-01', to: '2026-11-30' })
    expect(formatPeriodLabel('quarterly', 0)).toBe('Eyl – Kas 2026')
  })
  it('ay ay kayar', () => {
    expect(getPeriodRangeAt('quarterly', -1)).toEqual({ from: '2026-08-01', to: '2026-10-31' })
    expect(getPeriodRangeAt('quarterly', 2)).toEqual({ from: '2026-11-01', to: '2027-01-31' })
  })
})

describe('resolvePeriodRange', () => {
  it('tür + kaydırma', () => {
    expect(resolvePeriodRange({ type: 'monthly', offset: -8, custom: null })).toEqual({ from: '2026-03-01', to: '2026-03-31' })
  })
  it('özel aralıkta boş uçlar ay başı / bugün olur, kaydırma yok sayılır', () => {
    expect(resolvePeriodRange({ type: 'yearly', offset: -3, custom: { from: '', to: '' } }))
      .toEqual({ from: '2026-11-01', to: '2026-11-11' })
    expect(resolvePeriodRange({ type: 'monthly', offset: 0, custom: { from: '2026-01-05', to: '2026-02-10' } }))
      .toEqual({ from: '2026-01-05', to: '2026-02-10' })
  })
  it('özel aralığın adı', () => {
    expect(periodSelectionLabel({ type: 'monthly', offset: 0, custom: { from: '2026-01-05', to: '2026-02-10' } }))
      .toBe('5 Oca – 10 Şub 2026')
  })
})

describe('periodSelectionMonth — yalnız ay gösteren sayfaların ayı', () => {
  it('aylık gezinti', () => {
    expect(periodSelectionMonth({ type: 'monthly', offset: -8, custom: null })).toEqual({ month: 3, year: 2026 })
  })
  it('yıllık gezintide geçen yılın aynı ayı', () => {
    expect(periodSelectionMonth({ type: 'yearly', offset: -1, custom: null })).toEqual({ month: 11, year: 2025 })
  })
  it('3 aylıkta pencerenin son ayı', () => {
    expect(periodSelectionMonth({ type: 'quarterly', offset: -2, custom: null })).toEqual({ month: 9, year: 2026 })
  })
  it('özel aralıkta aralığın bittiği ay, Tüm Zamanlar\'da bu ay', () => {
    expect(periodSelectionMonth({ type: 'monthly', offset: 0, custom: { from: '2026-01-05', to: '2026-02-10' } })).toEqual({ month: 2, year: 2026 })
    expect(periodSelectionMonth({ type: 'all', offset: 0, custom: null })).toEqual({ month: 11, year: 2026 })
  })
})

describe('isDefaultSelection', () => {
  it('yalnız Aylık · bu ay · özel yok', () => {
    expect(isDefaultSelection({ type: 'monthly', offset: 0, custom: null })).toBe(true)
    expect(isDefaultSelection({ type: 'monthly', offset: -1, custom: null })).toBe(false)
    expect(isDefaultSelection({ type: 'yearly', offset: 0, custom: null })).toBe(false)
    expect(isDefaultSelection({ type: 'monthly', offset: 0, custom: { from: '', to: '' } })).toBe(false)
  })
})

describe('allTimeRange — Raporlar ve İstatistikler ortak', () => {
  it('en erken işlemden bugüne (son işleme değil)', () => {
    expect(allTimeRange([{ date: '2026-05-02' }, { date: '2024-03-15T10:00:00' }, { date: '2026-10-01' }]))
      .toEqual({ from: '2024-03-15', to: '2026-11-11' })
  })
  it('işlem yoksa ya da hepsi gelecekteyse bu yıl', () => {
    expect(allTimeRange([])).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(allTimeRange([{ date: '2027-01-01' }])).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('ui.store — sayfalar arası paylaşılan dönem', () => {
  it('tür seçmek güncel döneme döner ve özel aralıktan çıkar', () => {
    useUIStore.setState({ periodType: 'monthly', periodOffset: -4, customRange: { from: '2026-01-01', to: '' } })
    useUIStore.getState().setPeriodType('yearly')
    const s = useUIStore.getState()
    expect([s.periodType, s.periodOffset, s.customRange]).toEqual(['yearly', 0, null])
  })
  it('setMonth (Bütçeler/Aylık Özet) dönemi o aya taşır', () => {
    useUIStore.setState({ periodType: 'yearly', periodOffset: -1, customRange: { from: '', to: '' } })
    useUIStore.getState().setMonth({ month: 3, year: 2026 })
    const s = useUIStore.getState()
    expect([s.periodType, s.periodOffset, s.customRange]).toEqual(['monthly', -8, null])
  })
  it('monthsBetween', () => {
    expect(monthsBetween({ month: 11, year: 2026 }, { month: 2, year: 2027 })).toBe(3)
    expect(monthsBetween({ month: 11, year: 2026 }, { month: 11, year: 2025 })).toBe(-12)
  })
})
