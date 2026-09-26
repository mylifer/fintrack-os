import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { buildReport } from './error-reporter'

const env = { path: '/transactions?search=kira#x', userAgent: 'UA', release: 'abc1234' }

describe('buildReport', () => {
  it('hata nesnesinden mesaj ve yığın; yol sorgu dizesi ve hash olmadan', () => {
    const e = new Error('patladı')
    const r = buildReport('error', e, env)!
    expect(r).toMatchObject({ kind: 'error', message: 'patladı', path: '/transactions', release: 'abc1234' })
    expect(r.stack).toContain('patladı')
  })

  it('metin ve nesne sebepler; boş mesaj ve eklenti gürültüsü gönderilmez', () => {
    expect(buildReport('unhandledrejection', 'zaman aşımı', env)?.message).toBe('zaman aşımı')
    expect(buildReport('unhandledrejection', { code: 42 }, env)?.message).toBe('{"code":42}')
    expect(buildReport('error', '', env)).toBeNull()
    expect(buildReport('error', 'ResizeObserver loop completed with undelivered notifications.', env)).toBeNull()
    expect(buildReport('error', 'Script error.', env)).toBeNull()
  })

  it('uzunluk sınırları (tablo kısıtlarıyla aynı)', () => {
    const r = buildReport('error', 'a'.repeat(5000), { ...env, path: '/' + 'p'.repeat(1000) })!
    expect(r.message).toHaveLength(2000)
    expect(r.path).toHaveLength(300)
  })
})
