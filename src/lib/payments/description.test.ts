import { describe, it, expect } from 'vitest'
import { paymentDescription } from './schedule'
import { paymentTxIdFor } from './ids'

/* Ödeme işleminin açıklaması ve bildirim onayının kimliği.
   Kullanıcı isteği (2026-09-11): kart ödemeleri "Kredi Kartı Ödemesi", borç
   ödemeleri "İhtiyaç Kredisi Ödemesi" gibi borcun adıyla yazılsın. */

describe('paymentDescription', () => {
  it('kartta kart adından bağımsız "Kredi Kartı Ödemesi"', () => {
    expect(paymentDescription({ kind: 'card', name: 'Garanti Bonus' })).toBe('Kredi Kartı Ödemesi')
  })

  it('borçta "<ad> Ödemesi"', () => {
    expect(paymentDescription({ kind: 'debt', name: 'İhtiyaç Kredisi' })).toBe('İhtiyaç Kredisi Ödemesi')
    expect(paymentDescription({ kind: 'debt', name: '  Araba Kredisi ' })).toBe('Araba Kredisi Ödemesi')
  })

  it('ad zaten "ödemesi" ile bitiyorsa tekrar eklemez', () => {
    expect(paymentDescription({ kind: 'debt', name: 'Konut Kredisi Ödemesi' })).toBe('Konut Kredisi Ödemesi')
    expect(paymentDescription({ kind: 'debt', name: 'Okul ödemesi' })).toBe('Okul ödemesi')
  })
})

describe('paymentTxIdFor', () => {
  it('aynı hedef + ay için aynı, farklı ay için farklı kimlik (çift onay yok)', () => {
    const a = paymentTxIdFor('card', 'c1', '2026-09')
    expect(paymentTxIdFor('card', 'c1', '2026-09')).toBe(a)
    expect(paymentTxIdFor('card', 'c1', '2026-10')).not.toBe(a)
    expect(paymentTxIdFor('debt', 'c1', '2026-09')).not.toBe(a)
  })
})
