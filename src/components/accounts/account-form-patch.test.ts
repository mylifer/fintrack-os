import { describe, it, expect } from 'vitest'
import { accountFormPatch } from './account-form-patch'
import type { Account } from '@/types'

const base: Account = {
  id: 'a1', name: 'Kart', type: 'credit_card', currency: 'TRY', balance: -100,
  initialBalance: -100, color: '#111110', isArchived: false, createdAt: '2026-01-01T00:00:00.000Z',
  creditLimit: 5000, statementDay: 5, dueDay: 10,
}

describe('accountFormPatch', () => {
  it('değişmeyen alan yamaya girmez', () => {
    expect(accountFormPatch(base, { ...base })).toEqual({})
    expect(accountFormPatch(base, { ...base, name: 'Yeni Ad' })).toEqual({ name: 'Yeni Ad' })
  })

  it('form açıkken dışarıdan değişen alan korunur', () => {
    // Form açıkken Kart Takvimi kesim gününü 20 yaptı; kullanıcı yalnız adı değiştirdi
    const current: Account = { ...base, statementDay: 20, balance: -250 }
    const patch = accountFormPatch(base, { ...base, name: 'Yeni Ad' })
    expect({ ...current, ...patch }).toEqual({ ...current, name: 'Yeni Ad' })
  })

  it('kullanıcı aynı alanı da değiştirdiyse kullanıcının değeri kazanır', () => {
    const current: Account = { ...base, statementDay: 20 }
    const patch = accountFormPatch(base, { ...base, statementDay: 12 })
    expect({ ...current, ...patch }.statementDay).toBe(12)
  })

  it('açılışta olmayan alan eklenirse ya da undefined/null yapılırsa yamaya girer', () => {
    const opening: Partial<Account> = { ...base, icon: 'x' }
    expect(accountFormPatch(opening, { ...opening, icon: undefined, minPayPct: 20 }))
      .toEqual({ icon: undefined, minPayPct: 20 })
  })
})
