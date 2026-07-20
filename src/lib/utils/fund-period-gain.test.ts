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
  it('dönem başındaki pozisyonun değer artışını dönem ÖNCESİ son kapanıştan hesaplar', () => {
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    // Baz = dönem öncesi son kapanış 30.06 @100 → 10 pay: 100 → 130 = 300
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(300, 6)
  })

  it('seri dönem içi kapanışta geride kalsa bile (T+1) canlı fiyatla dönem öncesi bazdan hesaplar', () => {
    // Geçmiş seri yalnız dönem ÖNCESİ kapanışları içeriyor (canlı fp seriden önde).
    // Eskiden within boş → 0'a çöküyordu; artık baz 30.06 @100, dönem sonu canlı 130.
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    const histBefore = { AFA: [{ date: '2026-06-28', price: 95 }, { date: '2026-06-30', price: 100 }] }
    expect(calcFundPeriodGain(txs, FP, histBefore, FROM, TO, false)).toBeCloseTo(300, 6)
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
    // Baz = dönem öncesi son kapanış 30.06 @100. Dönem toplam değer değişimi:
    // son 5 pay×130 + satış 5×120 − başı 10×100 = 650 + 600 − 1000 = 250.
    // Gerçekleşen kâr (120−90)×5 = 150 gelir işlemlerinde zaten var → 250 − 150 = 100.
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(100, 6)
  })

  it('dönem içinde alınıp satılan pozisyonun kazancı tamamen gerçekleşmiştir → 0', () => {
    const txs = [
      tx({ type: 'buy',  quantity: 10, pricePerUnit: 100, date: '2026-07-05' }),
      tx({ type: 'sell', quantity: 10, pricePerUnit: 120, date: '2026-07-12' }),
    ]
    expect(calcFundPeriodGain(txs, FP, HIST, FROM, TO, false)).toBeCloseTo(0, 6)
  })

  it('geçmişte biten (özel) aralıkta dönem sonu, `to` gününe kadarki son kapanıştır — bugünkü fiyat değil', () => {
    // Pencere 01.07 → 10.07; canlı fiyat (FP.date 17.07) pencereden SONRA.
    const HIST_PAST: Record<string, FundPricePoint[]> = {
      AFA: [
        { date: '2026-06-30', price: 100 }, // dönem öncesi
        { date: '2026-07-02', price: 110 }, // dönem içi ilk kapanış (baz)
        { date: '2026-07-09', price: 125 }, // `to`'ya kadarki son kapanış (dönem sonu)
        { date: '2026-07-17', price: 130 }, // `to`'dan sonra — dahil edilmemeli
      ],
    }
    const txs = [tx({ type: 'buy', quantity: 10, pricePerUnit: 80, date: '2026-05-01' })]
    // Baz = dönem öncesi son kapanış 30.06 @100, dönem sonu 09.07 @125 → 10 pay: 100 → 125 = 250.
    // (Dönem sonu için bugünkü 130 alınsaydı yanlışlıkla 300 olurdu.)
    expect(calcFundPeriodGain(txs, FP, HIST_PAST, '2026-07-01', '2026-07-10', false)).toBeCloseTo(250, 6)
  })

  it('hafta Pazartesi: geçmiş seri Pzt kapanışında geri kalsa bile haftalık ≥ günlük (sıfıra çökmez)', () => {
    // Gerçek bug: canlı fp Pzt (07-20) fiyatını içerir ama /history serisi T+1
    // gecikmesiyle yalnız Cuma'ya (07-17) kadar gelir → within boş. Eskiden haftalık
    // 0'a çöküp günlükten (3000) düşük görünüyordu. Artık baz Cuma + canlı fiyat.
    const txs = [tx({ type: 'buy', quantity: 100, pricePerUnit: 80, date: '2026-05-01' })]
    const FP_MON: Record<string, TefasFundPrice> = {
      AFA: { code: 'AFA', name: 'AFA', price: 130, prevPrice: 100, date: '2026-07-20' }, // canlı: Pzt taze
    }
    const HIST_LAG: Record<string, FundPricePoint[]> = {
      AFA: [
        { date: '2026-07-16', price: 98 },
        { date: '2026-07-17', price: 100 }, // Cuma — serideki SON nokta (Pzt henüz yok)
      ],
    }
    const daily  = calcFundPeriodGain(txs, FP_MON, {},        '2026-07-20', '2026-07-20', true)  // 100×(130−100)
    const weekly = calcFundPeriodGain(txs, FP_MON, HIST_LAG,  '2026-07-20', '2026-07-26', false) // baz Cuma 100, sonu canlı 130
    expect(daily).toBeCloseTo(3000, 6)
    expect(weekly).toBeCloseTo(3000, 6)          // within boş olsa da 0'a çökmez
    expect(weekly).toBeGreaterThanOrEqual(daily) // günlük haftalığı ASLA aşmaz
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
