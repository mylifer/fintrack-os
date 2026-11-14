import { describe, it, expect, vi } from 'vitest'

// Kart modülü supabase istemcisini içe aktarır; saf gruplama testi için gerekmez
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

const { groupErrorLogs } = await import('./ErrorLogsCard')

describe('groupErrorLogs', () => {
  it('aynı mesajları gruplar, adet ve son görülmeyi tutar, en yeni önce', () => {
    const groups = groupErrorLogs([
      { created_at: '2026-11-01T10:00:00Z', message: 'A', path: '/dashboard' },
      { created_at: '2026-11-10T10:00:00Z', message: 'B', path: '/reports' },
      { created_at: '2026-11-12T10:00:00Z', message: 'A ', path: '/investments' },
      { created_at: '2026-11-05T10:00:00Z', message: 'A', path: '/dashboard' },
    ])
    expect(groups.map(g => g.message)).toEqual(['A', 'B'])
    expect(groups[0]).toMatchObject({ count: 3, lastAt: '2026-11-12T10:00:00Z' })
    expect(groups[0].paths.sort()).toEqual(['/dashboard', '/investments'])
  })

  it('boş girdi → boş liste; yolsuz satır sorun çıkarmaz', () => {
    expect(groupErrorLogs([])).toEqual([])
    expect(groupErrorLogs([{ created_at: '2026-11-01T00:00:00Z', message: 'x', path: null }])[0].paths).toEqual([])
  })
})
