import { describe, it, expect, vi, afterEach } from 'vitest'
import { isMarketAsset, marketAssetsIn, parseMarketAsset, yahooSymbol, marketSymbol } from './market'
import { fetchMarketQuote, fetchYahooChart, valueOn } from './server/yahoo'
import { assetLabel, assetIcon, getAssetPrice, computeHoldings } from '@/store/investment.store'
import type { InvestmentTransaction } from '@/types'

// Store'u saf fonksiyonları için içe aktarıyoruz; istemci kurulumu testte gereksiz
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

describe('market asset anahtarları', () => {
  it('ayrıştırma ve doğrulama', () => {
    expect(parseMarketAsset('bist:thyao')).toBe('BIST:THYAO')
    expect(parseMarketAsset('CRYPTO:BTC')).toBe('CRYPTO:BTC')
    expect(parseMarketAsset('BIST:TH')).toBeNull()       // hisse kodu en az 3
    expect(parseMarketAsset('NASDAQ:AAPL')).toBeNull()
    expect(parseMarketAsset('BIST:THYAO:X')).toBeNull()
    expect(parseMarketAsset('TEFAS:AFA')).toBeNull()
    expect(isMarketAsset('TEFAS:AFA')).toBe(false)
    expect(marketSymbol('CRYPTO:ETH')).toBe('ETH')
  })

  it('Yahoo sembolü: hisse .IS, kripto -USD', () => {
    expect(yahooSymbol('BIST:ASELS')).toBe('ASELS.IS')
    expect(yahooSymbol('CRYPTO:BTC')).toBe('BTC-USD')
  })

  it('işlem listesindeki farklı hisse/kripto varlıkları', () => {
    expect(marketAssetsIn(['GOLD_GRAM', 'BIST:THYAO', 'TEFAS:AFA', 'CRYPTO:BTC', 'BIST:THYAO'])).toEqual(['BIST:THYAO', 'CRYPTO:BTC'])
  })

  it('store: etiket, bağlı satır ikonu (boş olmamalı), fiyat ve portföy', () => {
    expect(assetLabel('BIST:THYAO')).toBe('THYAO')
    expect(assetIcon('BIST:THYAO')).toBeTruthy()
    expect(assetIcon('CRYPTO:BTC')).toBeTruthy()
    const fund = { 'BIST:THYAO': { code: 'THYAO', name: 'THY', price: 300, date: '2026-09-25' } }
    expect(getAssetPrice('BIST:THYAO', null, fund)).toBe(300)
    expect(getAssetPrice('CRYPTO:BTC', null, fund)).toBe(0)
    const txs: InvestmentTransaction[] = [
      { id: '1', type: 'buy', asset: 'BIST:THYAO', quantity: 10, pricePerUnit: 250, date: '2026-01-01', createdAt: '1' },
    ]
    const [h] = computeHoldings(txs, null, fund)
    expect(h).toMatchObject({ asset: 'BIST:THYAO', currentValue: 3000, pnl: 500 })
  })
})

describe('Yahoo grafiği ayrıştırma', () => {
  afterEach(() => vi.unstubAllGlobals())

  const chart = (meta: object, timestamp: number[], close: (number | null)[]) => ({
    ok: true,
    json: async () => ({ chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] } }] } }),
  })

  it('yerel gün (gmtoffset), null kapanış atlanır, canlı fiyat son nokta, önceki kapanış', async () => {
    // TRY=X mumları 23:00 UTC = Londra gece yarısı → ERTESİ gün
    const day = (d: string, h: number) => Date.UTC(2026, 8, Number(d), h) / 1000
    vi.stubGlobal('fetch', vi.fn(async () => chart(
      { regularMarketPrice: 49, gmtoffset: 3600, regularMarketTime: day('25', 22), shortName: 'USD/TRY' },
      [day('22', 23), day('23', 23), day('24', 23)],
      [48.5, null, 48.8],
    )))
    const c = await fetchYahooChart('TRY=X', { range: '5d' })
    expect(c?.points).toEqual([
      { date: '2026-09-23', price: 48.5 },
      { date: '2026-09-25', price: 48.8 },
    ])
    // regularMarketTime 22:00 UTC + 1 sa = 25 Eylül 23:00 → mevcut 25 Eylül noktası korunur
    expect(c?.date).toBe('2026-09-25')
    expect(c?.prevPrice).toBe(48.5)
  })

  it('kripto: USD fiyatı × USD/TRY; bulunamayan sembol null', async () => {
    const t = Date.UTC(2026, 8, 25) / 1000
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('BTC-USD')) return chart({ regularMarketPrice: 100, gmtoffset: 0, regularMarketTime: t + 3600, shortName: 'Bitcoin USD' }, [t - 86400, t], [90, 100])
      if (url.includes('TRY%3DX')) return chart({ regularMarketPrice: 40, gmtoffset: 0, regularMarketTime: t + 3600 }, [t - 86400, t], [39, 40])
      return { ok: false, json: async () => ({}) }
    }))
    const fx = () => fetchYahooChart('TRY=X', { range: '5d' })
    const q = await fetchMarketQuote('CRYPTO:BTC', fx)
    expect(q).toMatchObject({ code: 'BTC', name: 'Bitcoin', price: 4000, prevPrice: 90 * 39 })
    expect(await fetchMarketQuote('BIST:XXXXX', fx)).toBeNull()
  })

  it('valueOn: hafta sonu son bilinen değere düşer', () => {
    const pts = [{ date: '2026-09-18', price: 1 }, { date: '2026-09-21', price: 2 }]
    expect(valueOn(pts, '2026-09-20')).toBe(1)
    expect(valueOn(pts, '2026-09-22')).toBe(2)
    expect(valueOn(pts, '2026-09-01')).toBe(1)
  })
})
