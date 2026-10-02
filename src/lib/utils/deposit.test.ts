import { describe, it, expect } from 'vitest'
import { DEFAULT_DEPOSIT_TAX, depositInterestId, depositTerms, interestBooked, projectDeposit, rolledTerms } from './deposit'

const acc = (o: object) => ({ type: 'savings' as const, ...o })

describe('depositTerms', () => {
  it('yalnız vadeli hesapta ve eksiksiz koşulla; stopaj boşsa varsayılan', () => {
    expect(depositTerms(acc({ depositRate: 45, depositStart: '2026-09-01', depositEnd: '2026-10-03' })))
      .toEqual({ rate: 45, start: '2026-09-01', end: '2026-10-03', taxPct: DEFAULT_DEPOSIT_TAX })
    expect(depositTerms({ ...acc({ depositRate: 45, depositStart: '2026-09-01', depositEnd: '2026-10-03' }), type: 'checking' })).toBeNull()
    expect(depositTerms(acc({ depositRate: 0, depositStart: '2026-09-01', depositEnd: '2026-10-03' }))).toBeNull()
    expect(depositTerms(acc({ depositRate: 45, depositStart: '2026-10-03', depositEnd: '2026-09-01' }))).toBeNull()
    expect(depositTerms(acc({ depositRate: 45, depositStart: '2026-09-01' }))).toBeNull()
  })
})

describe('projectDeposit', () => {
  const t = { rate: 45, start: '2026-09-01', end: '2026-10-03', taxPct: 17.5 }  // 32 gün

  it('basit faiz, stopaj ve net; vade sonu değeri', () => {
    const p = projectDeposit(100_000, t, '2026-09-17')
    // 100.000 × 0,45 × 32 / 365 = 3.945,21
    expect(p).toMatchObject({ days: 32, gross: 3945.21, tax: 690.41, net: 3254.8, maturityValue: 103254.8 })
    expect(p.daysLeft).toBe(16)
    expect(p.accruedNet).toBeCloseTo(1627.4, 1)
    expect(p.matured).toBe(false)
  })

  it('vade günü ve sonrası: dolmuş, işlemiş faiz tam', () => {
    const p = projectDeposit(100_000, t, '2026-10-05')
    expect(p.matured).toBe(true)
    expect(p.daysLeft).toBe(0)
    expect(p.accruedNet).toBe(p.net)
    expect(projectDeposit(100_000, t, '2026-10-03').matured).toBe(true)
  })

  it('negatif bakiye faiz üretmez', () => {
    expect(projectDeposit(-500, t, '2026-09-10').gross).toBe(0)
  })
})

describe('rolledTerms', () => {
  it('aynı gün sayısıyla yenilenir', () => {
    expect(rolledTerms({ rate: 45, start: '2026-09-01', end: '2026-10-03', taxPct: 17.5 }))
      .toEqual({ rate: 45, start: '2026-10-03', end: '2026-11-04', taxPct: 17.5 })
  })
})

describe('faiz satırı kimliği ve çift işleme', () => {
  it('kimlik iOS ile aynı (DeterministicID.uuid("deposit:<hesap>:<vade sonu>"))', () => {
    expect(depositInterestId('acc-dep', '2026-10-01')).toBe('3cd79f4e-b7ef-44f4-a206-e6bc8cba62f7')
    expect(depositInterestId('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', '2026-11-04')).toBe('d6c83b2f-b803-4ff6-a761-1698bc567989')
  })

  it('işlenmiş faiz kimlikle ya da içerikle (eski rastgele kimlik) tanınır; silinmiş sayılmaz', () => {
    const base = { accountId: 'v', type: 'income' as const, date: '2026-10-03', description: 'Vadeli mevduat faizi (net, %45)' }
    expect(interestBooked([{ ...base, id: 'rastgele' }], 'v', '2026-10-03')).toBe(true)
    expect(interestBooked([{ ...base, id: depositInterestId('v', '2026-10-03'), description: 'elle değişti' }], 'v', '2026-10-03')).toBe(true)
    expect(interestBooked([{ ...base, id: 'r' }], 'v', '2026-11-04')).toBe(false)
    expect(interestBooked([{ ...base, id: 'r' }], 'baska', '2026-10-03')).toBe(false)
    expect(interestBooked([{ ...base, id: 'r', deleted_at: '2026-10-04T00:00:00Z' }], 'v', '2026-10-03')).toBe(false)
  })
})
