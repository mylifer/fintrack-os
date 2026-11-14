import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPresetRange, formatPresetLabel, presetAnchor, PRESET_UNIT } from './period'

describe('reports period', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 6, 15, 12)) }) // 15 Tem 2026 (Çarşamba)
  afterEach(() => { vi.useRealTimers() })

  it('presetlerin aralıkları', () => {
    expect(getPresetRange('today', '', '')).toEqual({ from: '2026-07-15', to: '2026-07-15' })
    expect(getPresetRange('this-week', '', '')).toEqual({ from: '2026-07-13', to: '2026-07-19' })
    expect(getPresetRange('this-month', '', '')).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(getPresetRange('last-month', '', '')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(getPresetRange('3-months', '', '')).toEqual({ from: '2026-05-01', to: '2026-07-31' })
    expect(getPresetRange('this-year', '', '')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('özel aralık boş uçlarda bu aya düşer', () => {
    expect(getPresetRange('custom', '2026-02-03', '')).toEqual({ from: '2026-02-03', to: '2026-07-31' })
  })

  it('offset gezinilebilir presetleri kendi biriminde kaydırır', () => {
    expect(getPresetRange('this-month', '', '', -1)).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(getPresetRange('this-year', '', '', 1)).toEqual({ from: '2027-01-01', to: '2027-12-31' })
    expect(PRESET_UNIT['all-time']).toBeUndefined()
    expect(presetAnchor('all-time', 5).getFullYear()).toBe(2026)
  })

  it('dönem etiketleri', () => {
    expect(formatPresetLabel('this-month', 0)).toBe('Temmuz 2026')
    expect(formatPresetLabel('3-months', 0)).toBe('May – Tem 2026')
    expect(formatPresetLabel('this-year', -1)).toBe('2025')
    expect(formatPresetLabel('custom', 0)).toBe('')
  })
})
