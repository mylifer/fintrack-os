import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PriceData } from '@/types'
import { applyTurkishGold, fetchTurkishGoldClient, parseTurkishGold } from './turkish-gold'

const truncgil = {
  GRA:         { Buying: 6739.97, Change: 0.33 },
  CEYREKALTIN: { Buying: 10722.45, Change: 0.24 },
  YARIMALTIN:  { Buying: 21377.89, Change: 0.24 },
  TAMALTIN:    { Buying: 42889.81, Change: 0.24 },
  YIA:         { Buying: 6111.8, Change: 0.24 },
}

// Sunucunun spot türetmeye düştüğü yanıt (gram 6793,69; ziynetler gramdan çarpanla)
const server = {
  usdTry: 48.9, eurTry: 57, gbpTry: 65,
  goldGramTry: 6793.69, goldQuarterTry: 6793.69 * 1.6067, goldHalfTry: 6793.69 * 3.2133,
  goldFullTry: 6793.69 * 6.4267, bilezikGramTry: 6793.69 * 0.916,
  updatedAt: 0,
} as PriceData

describe('parseTurkishGold', () => {
  it('ALIŞ fiyatını alır, önceki kapanışı % değişimden geri hesaplar', () => {
    const g = parseTurkishGold(truncgil)!
    expect(g.gram!.current).toBe(6739.97)
    expect(g.gram!.prev).toBeCloseTo(6739.97 / 1.0033, 6)
    expect(g.bracelet!.current).toBe(6111.8)
  })

  it('geçersiz / boş yanıtta null', () => {
    expect(parseTurkishGold(null)).toBeNull()
    expect(parseTurkishGold({ GRA: { Buying: 0 } })).toBeNull()
    expect(parseTurkishGold({ GRA: { Buying: '6739' } })).toBeNull()
  })
})

describe('applyTurkishGold', () => {
  it('altın alanlarını Kapalıçarşı değeriyle değiştirir, kurlara dokunmaz', () => {
    const out = applyTurkishGold(server, parseTurkishGold(truncgil))
    expect(out.goldGramTry).toBe(6739.97)
    expect(out.goldQuarterTry).toBe(10722.45)
    expect(out.goldHalfTry).toBe(21377.89)
    expect(out.goldFullTry).toBe(42889.81)
    expect(out.bilezikGramTry).toBe(6111.8)
    expect(out.usdTry).toBe(48.9)
  })

  it('kotasyon yoksa sunucu yanıtı aynen kalır', () => {
    expect(applyTurkishGold(server, null)).toBe(server)
  })

  it('eksik kalem sunucu değerinde kalır', () => {
    const out = applyTurkishGold(server, parseTurkishGold({ GRA: truncgil.GRA }))
    expect(out.goldGramTry).toBe(6739.97)
    expect(out.goldQuarterTry).toBe(server.goldQuarterTry)
  })
})

describe('fetchTurkishGoldClient', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('taze kotasyonu döner ve saklar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(truncgil), { status: 200 })))
    const g = await fetchTurkishGoldClient(1_000)
    expect(g?.gram?.current).toBe(6739.97)
    expect(store.size).toBe(1)
  })

  it('erişilemezse 24 saate kadar son başarılı kotasyona düşer, daha eskisine düşmez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(truncgil), { status: 200 })))
    await fetchTurkishGoldClient(0)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    expect((await fetchTurkishGoldClient(23 * 3600_000))?.gram?.current).toBe(6739.97)
    expect(await fetchTurkishGoldClient(25 * 3600_000)).toBeNull()
  })
})
