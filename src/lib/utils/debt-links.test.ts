import { describe, it, expect } from 'vitest'
import { debtPrincipalDescription, findDebtPrincipalTx } from './debt-links'
import type { Debt, Transaction } from '@/types'

type Candidate = Pick<Transaction, 'icon' | 'description' | 'debtPrincipalId'> & { id: string }

function tx(partial: Partial<Candidate> & { id: string }): Candidate {
  return { icon: '🏦', description: '', ...partial }
}

function debt(partial: Partial<Debt> & { id: string }): Pick<Debt, 'id' | 'name' | 'direction'> {
  return { name: 'Araba Kredisi', direction: 'owe', ...partial }
}

describe('debtPrincipalDescription', () => {
  it('yön son ekini taşır — akış dışı işareti bu açıklamadan gelir', () => {
    expect(debtPrincipalDescription({ name: 'Araba Kredisi', direction: 'owe' }))
      .toBe('Araba Kredisi — borç girişi')
    expect(debtPrincipalDescription({ name: "Ahmet'e Borç", direction: 'owed' }))
      .toBe("Ahmet'e Borç — verilen borç")
  })
})

describe('findDebtPrincipalTx', () => {
  it('ID bağı varsa yalnız o satırı döndürür — aynı isimli ikinci borcun satırına bakmaz', () => {
    const ledger = [
      tx({ id: 'p1', description: 'Araba Kredisi — borç girişi', debtPrincipalId: 'd1' }),
      tx({ id: 'p2', description: 'Araba Kredisi — borç girişi', debtPrincipalId: 'd2' }),
    ]
    expect(findDebtPrincipalTx(debt({ id: 'd2' }), ledger)?.id).toBe('p2')
  })

  it('ID bağı yoksa (eski satır) açıklama + icon eşleşmesine düşer', () => {
    const ledger = [
      tx({ id: 'p1', description: 'Araba Kredisi — borç girişi' }),
      tx({ id: 'x1', description: 'Araba Kredisi ödemesi' }),
    ]
    expect(findDebtPrincipalTx(debt({ id: 'd1' }), ledger)?.id).toBe('p1')
  })

  it('icon taşımayan kullanıcı satırı anapara sayılmaz', () => {
    const ledger = [tx({ id: 'u1', icon: undefined, description: 'Araba Kredisi — borç girişi' })]
    expect(findDebtPrincipalTx(debt({ id: 'd1' }), ledger)).toBeUndefined()
  })

  it('başka bir borca bağlanmış satır fallback adayı olamaz', () => {
    const ledger = [tx({ id: 'p1', description: 'Araba Kredisi — borç girişi', debtPrincipalId: 'baska' })]
    expect(findDebtPrincipalTx(debt({ id: 'd1' }), ledger)).toBeUndefined()
  })

  it('birden fazla eşleşmede hiçbirine dokunulmaz — yanlış satırı taşımaktansa hiç taşıma', () => {
    const ledger = [
      tx({ id: 'p1', description: 'Araba Kredisi — borç girişi' }),
      tx({ id: 'p2', description: 'Araba Kredisi — borç girişi' }),
    ]
    expect(findDebtPrincipalTx(debt({ id: 'd1' }), ledger)).toBeUndefined()
  })

  it('yön "owed" ise verilen borç satırını eşler, giriş satırını değil', () => {
    const ledger = [
      tx({ id: 'in',  description: "Ahmet'e Borç — borç girişi" }),
      tx({ id: 'out', icon: '🤝', description: "Ahmet'e Borç — verilen borç" }),
    ]
    expect(findDebtPrincipalTx(debt({ id: 'd1', name: "Ahmet'e Borç", direction: 'owed' }), ledger)?.id).toBe('out')
  })
})
