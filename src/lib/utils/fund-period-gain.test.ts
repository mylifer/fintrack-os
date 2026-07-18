import { describe, it, expect } from 'vitest'
import { calcFundPeriodGain, type FundPricePoint } from './fund-period-gain'
import type { InvestmentTransaction, TefasFundPrice } from '@/types'

function tx(p: Partial<InvestmentTransaction> & Pick<InvestmentTransaction, 'type' | 'quantity' | 'pricePerUnit' | 'date'>): InvestmentTransaction {
  return { id: p.date + p.type, asset: 'TEFAS:AFA', createdAt: p.date + 'T10:00:00Z', ...p }
}

const FP: Record<string, TefasFundPrice> = {
  AFA: { code: 'AFA', name: 'AFA Fonu', price: 130, prevPrice: 125, date: '2026-07-17' },
}

const HIST: Record<string, FundPricePoint[]> = {
  AFA: [
    { date: '2026-06-28', price: 95 },
    { date: '2026-06-30', price: 100 }, // dönem başı (01.07) öncesi son kapanış
    { date: '2026-07-10', price: 120 },
    { date: '2026-07-17', price: 130 },
  ],
}

const FROM = '2026-07-01'
const TO   = '2026-07-31'

describe('calcFundPeriodGain', () => {
  it('dönem başındaki pozisyonun değer artışını dönem başı kapanışından hesaplar', () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    // 10 pay: 100 → 130
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(300, 6)
  })

  it('dönem içi alım kendi maliyetinden sayılır, dönem başı bazından değil', () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 120, date: '2026-07-10' })]
    // 10 pay: 120 → 130
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(100, 6)
  })

  it('dönem içi satışın gerçekleşen kârını düşer (ayrı gelir işlemi olarak zaten kayıtlı)', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 90,  date: '2026-05-01' }),
      tx({ type: 'sell', quantity: 5,  pricePerUnit: 120, date: '2026-07-10' }),
    ]
    // Toplam dönem getirisi: satılan 5 pay 100→120 (+100) + kalan 5 pay 100→130 (+150) = 250
    // Gerçekleşen kâr (120−90)×5 = 150 gelir işlemlerinde zaten var → burada 100 kalmalı
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(100, 6)
  })

  it('dönem içinde alınıp satılan pozisyonun kazancı tamamen gerçekleşmiştir → 0', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 100, date: '2026-07-05' }),
      tx({ type: 'sell', quantity: 10, pricePerUnit: 120, date: '2026-07-12' }),
    ]
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(0, 6)
  })

  it("'Tüm Zamanlar': geçmiş seri olmadan gerçekleşmemiş K/Z döner", () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 80,  date: '2026-05-01' }),
      tx({ type: 'sell', quantity: 4,  pricePerUnit: 110, date: '2026-06-10' }),
    ]
    // Kalan 6 pay, maliyet 80 → 130: gerçekleşmemiş 300; satış kârı (110−80)×4=120 hariç
    expect(calcFundPeriodGain(txs, FP, {}, '1900-01-01', '2099-12-31', false)).toBeCloseTo(300, 6)
  })

  it("'Bugün': TEFAS bugün taze kapanış yayınladıysa son iki kapanış farkı × eldeki miktar", () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    // to = fiyat tarihi (2026-07-17) → taze: 10 × (130 − 125)
    expect(calcFundPeriodGain(txs, FP, {}, '2026-07-17', '2026-07-17', true)).toBeCloseTo(50, 6)
  })

  it("'Bugün': fiyat bayatsa (hafta sonu/tatil, son kapanış ≠ bugün) günlük getiri 0", () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    // to = Pazar (2026-07-19); son kapanış Cuma (FP.date 2026-07-17) → 0
    expect(calcFundPeriodGain(txs, FP, {}, '2026-07-19', '2026-07-19', true)).toBe(0)
  })

  it('geçmiş seri yüklenemezse günlük değişime düşer', () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    expect(calcFundPeriodGain(txs, FP, {}, FROM, TO, false)).toBeCloseTo(50, 6)
  })

  it('TEFAS dışı varlıkları yok sayar', () => {
    const txs = [{ ...tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' }), asset: 'USD' as const }]
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBe(0)
  })
})
