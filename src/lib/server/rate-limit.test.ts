import { describe, it, expect } from 'vitest'
import { SlidingWindowLimiter, clientKey, rateLimit, RATE_LIMITS, USER_ID_HEADER } from './rate-limit'

const W = 60_000

describe('SlidingWindowLimiter', () => {
  it('sınıra kadar izin verir, aşanı reddeder', () => {
    const l = new SlidingWindowLimiter({ limit: 3, windowMs: W })
    const t = 10 * W // pencere başı
    expect(l.hit('a', t).ok).toBe(true)
    expect(l.hit('a', t + 1).ok).toBe(true)
    const third = l.hit('a', t + 2)
    expect(third.ok).toBe(true)
    expect(third.remaining).toBe(0)
    const denied = l.hit('a', t + 3)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('anahtarlar birbirinden bağımsız', () => {
    const l = new SlidingWindowLimiter({ limit: 1, windowMs: W })
    expect(l.hit('a', 0).ok).toBe(true)
    expect(l.hit('a', 1).ok).toBe(false)
    expect(l.hit('b', 2).ok).toBe(true)
  })

  it('pencere sınırında 2× patlamaya izin vermez (kayan pencere)', () => {
    const l = new SlidingWindowLimiter({ limit: 10, windowMs: W })
    const t = 10 * W
    // Pencerenin son anında 10 istek
    for (let i = 0; i < 10; i++) expect(l.hit('a', t + W - 10 + i).ok).toBe(true)
    // Yeni pencerenin hemen başında: önceki pencere neredeyse tam ağırlıkta
    expect(l.hit('a', t + W + 1).ok).toBe(false)
    // Yarım pencere sonra önceki payı ~5'e iner → ~4 yeni istek sığar
    let allowed = 0
    for (let i = 0; i < 10; i++) if (l.hit('a', t + W + W / 2 + i).ok) allowed++
    expect(allowed).toBeGreaterThanOrEqual(4)
    expect(allowed).toBeLessThanOrEqual(5)
  })

  it('iki pencere boyunca sessiz kalan anahtar sıfırdan başlar', () => {
    const l = new SlidingWindowLimiter({ limit: 2, windowMs: W })
    l.hit('a', 0); l.hit('a', 1)
    expect(l.hit('a', 2).ok).toBe(false)
    expect(l.hit('a', 2 * W + 5).ok).toBe(true)
    expect(l.hit('a', 2 * W + 6).ok).toBe(true)
  })

  it('reddedilen istek sayılmaz; Retry-After sonrası yeniden izin verilir', () => {
    const l = new SlidingWindowLimiter({ limit: 5, windowMs: W })
    const t = 10 * W
    for (let i = 0; i < 5; i++) l.hit('a', t + i)
    let last = l.hit('a', t + 10)
    for (let i = 0; i < 100; i++) last = l.hit('a', t + 20 + i)   // ısrarlı istemci
    expect(last.ok).toBe(false)
    const waitMs = last.retryAfterSec * 1000
    // Söylenen süre dolmadan önce hâlâ red, dolunca izin
    expect(l.hit('a', t + 120 + waitMs - 2000).ok).toBe(false)
    expect(l.hit('a', t + 120 + waitMs).ok).toBe(true)
  })

  it('anahtar uzayı tavanlı (sahte IP selinde bellek büyümez)', () => {
    const l = new SlidingWindowLimiter({ limit: 5, windowMs: W }, 100)
    for (let i = 0; i < 5_000; i++) l.hit(`ip:${i}`, i)
    expect(l.size).toBeLessThanOrEqual(100)
  })
})

describe('clientKey', () => {
  it('proxy kullanıcı başlığını IP\'ye tercih eder', () => {
    const h = new Headers({ [USER_ID_HEADER]: 'uid-1', 'x-forwarded-for': '1.2.3.4' })
    expect(clientKey(h)).toBe('u:uid-1')
  })
  it('kullanıcı yoksa X-Forwarded-For\'un ilk değeri', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('ip:1.2.3.4')
    expect(clientKey(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('ip:5.6.7.8')
    expect(clientKey(new Headers())).toBe('ip:unknown')
  })
})

describe('rateLimit (rota yardımcısı)', () => {
  it('sınır aşılınca 429 + Retry-After döner', async () => {
    const req = () => new Request('http://x/api/prices', { headers: { [USER_ID_HEADER]: 'rl-test-user' } })
    for (let i = 0; i < RATE_LIMITS.prices.limit; i++) expect(rateLimit(req(), 'prices')).toBeNull()
    const res = rateLimit(req(), 'prices')
    expect(res?.status).toBe(429)
    expect(Number(res?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect((await res!.json()).error).toBeTruthy()
    // Başka kullanıcı etkilenmez
    expect(rateLimit(new Request('http://x', { headers: { [USER_ID_HEADER]: 'other-user' } }), 'prices')).toBeNull()
  })
})
