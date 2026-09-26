import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { buildCardStatements, dueDateAfter, statementPeriods } from './card-statement'

const tx = (o: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2), type: 'expense', amount: 0, currency: 'TRY', date: '2026-09-01',
  accountId: 'cc', description: '', isInstallment: false, createdAt: '', updatedAt: '', ...o,
})

describe('statementPeriods', () => {
  it('kesim gününe göre açık ve kapanmış dönemler (yeniden eskiye)', () => {
    const { open, closed } = statementPeriods(15, '2026-09-25', 2)
    expect(open).toEqual({ from: '2026-09-16', to: '2026-10-15' })
    expect(closed).toEqual([
      { from: '2026-08-16', to: '2026-09-15' },
      { from: '2026-07-16', to: '2026-08-15' },
    ])
  })

  it('kesim günü bugünse dönem hâlâ açıktır', () => {
    expect(statementPeriods(25, '2026-09-25', 1).open).toEqual({ from: '2026-08-26', to: '2026-09-25' })
  })

  it('yıl dönümü ve Ocak kesimi', () => {
    const { open, closed } = statementPeriods(28, '2027-01-05', 1)
    expect(open).toEqual({ from: '2026-12-29', to: '2027-01-28' })
    expect(closed[0]).toEqual({ from: '2026-11-29', to: '2026-12-28' })
  })
})

describe('dueDateAfter', () => {
  it('kesimden sonraki ilk son ödeme günü; kısa aylarda ay sonu', () => {
    expect(dueDateAfter('2026-09-15', 25)).toBe('2026-09-25')
    expect(dueDateAfter('2026-09-15', 5)).toBe('2026-10-05')
    expect(dueDateAfter('2026-01-28', 31)).toBe('2026-01-31')
    expect(dueDateAfter('2026-02-10', 31)).toBe('2026-02-28')
    expect(dueDateAfter('2026-09-15', 15)).toBe('2026-10-15')
  })
})

describe('buildCardStatements', () => {
  const account = { id: 'cc', currency: 'TRY' as const, statementDay: 15 }

  it('dönem borcu: gider + karttan transfer − iade; ödemeler ve mutabakat hariç', () => {
    const payment = tx({ id: 'pay', type: 'transfer', accountId: 'bank', toAccountId: 'cc', amount: 1000, date: '2026-09-20' })
    const incomePay = tx({ id: 'pay2', type: 'income', amount: 200, date: '2026-09-01', description: 'Kredi Kartı Ödemesi' })
    const rows = [
      tx({ amount: 1500, date: '2026-08-20' }),
      tx({ type: 'transfer', toAccountId: 'cash', amount: 300, date: '2026-09-01' }), // nakit avans
      tx({ type: 'income', amount: 100, date: '2026-09-10' }),                          // iade
      tx({ amount: 999, date: '2026-09-10', systemKind: 'reconciliation' }),
      tx({ amount: 50, date: '2026-09-10', accountId: 'baska-kart' }),
      incomePay,
      payment,
    ]
    const { statements } = buildCardStatements(account, rows, {
      payments: [payment, incomePay], dueDay: 25, minPayPct: 20, todayStr: '2026-09-26', count: 1,
    })
    const s = statements[0]
    expect(s.period).toEqual({ from: '2026-08-16', to: '2026-09-15' })
    expect(s.total).toBe(1700)
    expect(s.dueDate).toBe('2026-09-25')
    expect(s.minPayment).toBe(340)
    expect(s.paid).toBe(1000)
    // son ödeme geçti ama asgari (340) ödendi → gecikmiş değil, kısmi
    expect(s.status).toBe('partial')
  })

  it('durumlar: borç yok, ödendi, gecikti, bekliyor; son ödeme günü yoksa null', () => {
    const rows = [tx({ amount: 500, date: '2026-09-01' })]
    const base = { dueDay: 25, minPayPct: null, count: 1 }
    const pay = (amount: number, date: string) => tx({ type: 'transfer', accountId: 'bank', toAccountId: 'cc', amount, date })

    expect(buildCardStatements(account, [], { ...base, payments: [], todayStr: '2026-09-26' }).statements[0].status).toBe('clear')
    const p1 = pay(500, '2026-09-24')
    expect(buildCardStatements(account, rows, { ...base, payments: [p1], todayStr: '2026-09-26' }).statements[0].status).toBe('paid')
    expect(buildCardStatements(account, rows, { ...base, payments: [], todayStr: '2026-09-26' }).statements[0].status).toBe('overdue')
    expect(buildCardStatements(account, rows, { ...base, payments: [], todayStr: '2026-09-20' }).statements[0].status).toBe('open')

    const noDue = buildCardStatements(account, rows, { payments: [], dueDay: null, minPayPct: null, todayStr: '2026-09-26', count: 1 })
    expect(noDue.statements[0].dueDate).toBeNull()
    expect(noDue.statements[0].status).toBe('open')
  })

  it('açık dönem: bugüne kadar işlenmiş satırlar; gelecek taksit sayılmaz', () => {
    const rows = [
      tx({ amount: 80, date: '2026-09-20' }),
      tx({ amount: 70, date: '2026-10-10', isInstallment: true, installGroupId: 'g' }),
    ]
    const { open } = buildCardStatements(account, rows, { payments: [], dueDay: null, minPayPct: null, todayStr: '2026-09-26' })
    expect(open.period).toEqual({ from: '2026-09-16', to: '2026-10-15' })
    expect(open.total).toBe(80)
  })
})
