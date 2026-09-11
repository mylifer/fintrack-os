import { describe, it, expect } from 'vitest'
import type { Account, Debt, PaymentOccurrence, PaymentPlan, Transaction } from '@/types'
import {
  buildSchedule, buildTargets, dueDateFor, estimateStatement, monthKeys, occurrenceIdFor, planIdFor,
  shiftMonth, statementWindow, summarizeRows,
} from './schedule'

/* ────────────────────────────────────────────────────────────────────────
   Ödeme takibi çizelgesi

   Kritik değişmezler: (1) hiçbir kayıt yokken bile her kart/borç için doğru
   vade ve tutarla satır üretilir, (2) ödeme penceresine düşen işlem o ayı
   ödendi sayar ama başka ayı saymaz, (3) takip başlangıcından önce yanlış
   "gecikti" alarmı çıkmaz, (4) borç kalan tutarı tükenince aylar biter.
──────────────────────────────────────────────────────────────────────── */

const TODAY = '2026-10-05'

function card(p: Partial<Account> = {}): Account {
  return {
    id: 'card1', name: 'Bonus', type: 'credit_card', currency: 'TRY', balance: -12_000, initialBalance: 0,
    color: '#10b981', isArchived: false, createdAt: '2026-01-01T00:00:00.000Z',
    creditLimit: 50_000, statementDay: 28, dueDay: 10, ...p,
  }
}

function debt(p: Partial<Debt> = {}): Debt {
  return {
    id: 'debt1', name: 'Araba Kredisi', type: 'bank_loan', direction: 'owe', totalAmount: 30_000,
    paidAmount: 0, startDate: '2026-09-15', monthlyPayment: 5_000, totalInstallments: 6,
    accountId: 'chk', isSettled: false, createdAt: '2026-09-01T00:00:00.000Z', ...p,
  }
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount'>): Transaction {
  return {
    type: 'expense', currency: 'TRY', accountId: 'chk', description: 'x', isInstallment: false,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...p,
  }
}

const cardPayment = (id: string, date: string, amount: number) =>
  tx({ id, date, amount, type: 'transfer', accountId: 'chk', toAccountId: 'card1' })

function occ(p: Partial<PaymentOccurrence> & Pick<PaymentOccurrence, 'targetKind' | 'targetId' | 'month'>): PaymentOccurrence {
  return { id: occurrenceIdFor(p.targetKind, p.targetId, p.month), createdAt: '2026-10-01', updatedAt: '2026-10-01', ...p }
}

function plan(p: Partial<PaymentPlan> & Pick<PaymentPlan, 'targetKind' | 'targetId'>): PaymentPlan {
  return { id: planIdFor(p.targetKind, p.targetId), isActive: true, createdAt: '2026-10-01', updatedAt: '2026-10-01', ...p }
}

function schedule(opts: {
  accounts?: Account[]
  debts?: Debt[]
  plans?: PaymentPlan[]
  transactions?: Transaction[]
  occurrences?: PaymentOccurrence[]
  from: string
  to?: string
}) {
  const targets = buildTargets({ accounts: opts.accounts ?? [], debts: opts.debts ?? [], plans: opts.plans ?? [] })
  return buildSchedule({
    targets,
    occurrences: opts.occurrences ?? [],
    transactions: opts.transactions ?? [],
    from: opts.from,
    to: opts.to ?? opts.from,
    todayStr: TODAY,
  })
}

describe('ay yardımcıları', () => {
  it('yıl sınırında ay kaydırır', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-10', -13)).toBe('2025-09')
  })

  it('ay aralığını iki uç dahil üretir', () => {
    expect(monthKeys('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthKeys('2026-11', '2026-10')).toEqual([])
  })

  it('vade gününü kısa aylarda ay sonuna sıkıştırır', () => {
    expect(dueDateFor('2026-02', 31)).toBe('2026-02-28')
    expect(dueDateFor('2028-02', 30)).toBe('2028-02-29')
    expect(dueDateFor('2026-09', 31)).toBe('2026-09-30')
    expect(dueDateFor('2026-10', 5)).toBe('2026-10-05')
  })
})

describe('buildTargets', () => {
  it('yalnız arşivlenmemiş kredi kartlarını ve ödenecek borçları alır', () => {
    const targets = buildTargets({
      accounts: [card(), card({ id: 'old', isArchived: true }), card({ id: 'chk', type: 'checking' })],
      debts: [debt(), debt({ id: 'lent', direction: 'owed' })],
      plans: [],
    })
    expect(targets.map(t => t.key)).toEqual(['card:card1', 'debt:debt1'])
  })

  it('kartta günü dueDay\'den alır, tutarı boş bırakır (ekstre tahmini)', () => {
    const [t] = buildTargets({ accounts: [card()], debts: [], plans: [] })
    expect(t.dayOfMonth).toBe(10)
    expect(t.defaultAmount).toBeNull()
    expect(t.outstanding).toBe(12_000)
    expect(t.startMonth).toBe('2026-09') // TRACKING_EPOCH, kart daha eski
  })

  it('borçta tutar/hesap/gün/bitiş ayını borcun alanlarından türetir', () => {
    const [t] = buildTargets({ accounts: [], debts: [debt()], plans: [] })
    expect(t.defaultAmount).toBe(5_000)
    expect(t.defaultAmountSource).toBe('derived')
    expect(t.defaultFromAccountId).toBe('chk')
    expect(t.dayOfMonth).toBe(15)
    expect(t.endMonth).toBe('2027-02')
  })

  it('plan varsayılanları türetmeyi ezer', () => {
    const [t] = buildTargets({
      accounts: [card()],
      debts: [],
      plans: [plan({ targetKind: 'card', targetId: 'card1', amount: 7_500, dayOfMonth: 3, fromAccountId: 'sav', startMonth: '2026-06', isActive: false })],
    })
    expect(t.defaultAmount).toBe(7_500)
    expect(t.defaultAmountSource).toBe('plan')
    expect(t.dayOfMonth).toBe(3)
    expect(t.defaultFromAccountId).toBe('sav')
    expect(t.startMonth).toBe('2026-06')
    expect(t.isActive).toBe(false)
  })
})

describe('kart ekstresi', () => {
  it('vadeden önceki son kesimde kapanan dönemi seçer', () => {
    expect(statementWindow({ statementDay: 28 }, '2026-10-10')).toEqual({ from: '2026-08-29', to: '2026-09-28' })
    expect(statementWindow({ statementDay: 5 }, '2026-10-10')).toEqual({ from: '2026-09-06', to: '2026-10-05' })
    expect(statementWindow({ statementDay: 31 }, '2026-10-10')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(statementWindow({}, '2026-10-10')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('dönem harcamasını toplar; karta yapılan ödemeyi ve dönem dışını saymaz', () => {
    const txs = [
      tx({ id: 'a', date: '2026-09-02', amount: 1_000, accountId: 'card1' }),
      tx({ id: 'b', date: '2026-09-20', amount: 200, accountId: 'card1', type: 'income' }),
      tx({ id: 'c', date: '2026-09-10', amount: 5_000, accountId: 'chk', type: 'transfer', toAccountId: 'card1' }),
      tx({ id: 'd', date: '2026-09-29', amount: 900, accountId: 'card1' }),
      tx({ id: 'e', date: '2026-09-15', amount: 300, accountId: 'card1', systemKind: 'reconciliation' }),
    ]
    expect(estimateStatement(card(), '2026-10-10', txs)).toBe(800)
  })
})

describe('buildSchedule — kart', () => {
  const charge = tx({ id: 'ch', date: '2026-09-05', amount: 3_000, accountId: 'card1' })

  it('kayıt yokken ekstre tahminiyle açık satır üretir', () => {
    const [row] = schedule({ accounts: [card()], transactions: [charge], from: '2026-10' })
    expect(row.dueDate).toBe('2026-10-10')
    expect(row.amount).toBe(3_000)
    expect(row.amountSource).toBe('estimate')
    expect(row.state).toBe('open')
    expect(row.timing).toBe('soon')
    expect(row.daysLeft).toBe(5)
    expect(row.remaining).toBe(3_000)
    expect(row.occurrence).toBeNull()
  })

  it('pencereye düşen karta transferi ödendi sayar', () => {
    const [row] = schedule({ accounts: [card()], transactions: [charge, cardPayment('p1', '2026-10-03', 3_000)], from: '2026-10' })
    expect(row.state).toBe('paid')
    expect(row.paidVia).toBe('detected')
    expect(row.transactionIds).toEqual(['p1'])
    expect(row.timing).toBe('done')
  })

  it('eksik ödemeyi kısmi sayar ve kalanı hesaplar', () => {
    const [row] = schedule({ accounts: [card()], transactions: [charge, cardPayment('p1', '2026-10-01', 1_000)], from: '2026-10' })
    expect(row.state).toBe('partial')
    expect(row.remaining).toBe(2_000)
  })

  it('ödemeyi yalnız kendi penceresindeki aya yazar', () => {
    // Eylül penceresi (17 Ağu, 17 Eyl]; 16 Eylül'deki ödeme Ekim'i ödemez.
    const rows = schedule({
      accounts: [card()],
      plans: [plan({ targetKind: 'card', targetId: 'card1', amount: 2_000 })],
      transactions: [cardPayment('p1', '2026-09-16', 2_000)],
      from: '2026-09',
      to: '2026-10',
    })
    expect(rows.map(r => [r.month, r.state])).toEqual([['2026-09', 'paid'], ['2026-10', 'open']])
  })

  it('onay bekleyen ileri tarihli transferi ödeme saymaz', () => {
    const pending = { ...cardPayment('p1', '2026-10-08', 3_000), approvalStatus: 'pending' as const }
    const [row] = schedule({ accounts: [card()], transactions: [charge, pending], from: '2026-10' })
    expect(row.state).toBe('open')
  })

  it('elle bağlanmış işlem başka ayda tespit edilmez', () => {
    const rows = schedule({
      accounts: [card()],
      plans: [plan({ targetKind: 'card', targetId: 'card1', amount: 2_000 })],
      transactions: [cardPayment('p1', '2026-11-12', 2_000)],
      occurrences: [occ({ targetKind: 'card', targetId: 'card1', month: '2026-10', status: 'paid', paidAmount: 2_000, transactionId: 'p1' })],
      from: '2026-10',
      to: '2026-11',
    })
    expect(rows.find(r => r.month === '2026-10')?.paidVia).toBe('manual')
    expect(rows.find(r => r.month === '2026-11')?.state).toBe('open')
  })

  it('ay kaydı tutarı, tarihi ve hesabı o ay için ezer', () => {
    const [row] = schedule({
      accounts: [card()],
      transactions: [charge],
      occurrences: [occ({ targetKind: 'card', targetId: 'card1', month: '2026-10', amount: 4_500, dueDate: '2026-10-20', fromAccountId: 'sav' })],
      from: '2026-10',
    })
    expect(row.amount).toBe(4_500)
    expect(row.amountSource).toBe('custom')
    expect(row.dueDate).toBe('2026-10-20')
    expect(row.fromAccountId).toBe('sav')
    expect(row.custom).toEqual({ amount: true, dueDate: true, fromAccount: true })
    expect(row.timing).toBe('later')
  })

  it('atlanan ay kalan ve gecikme üretmez', () => {
    const [row] = schedule({
      accounts: [card()],
      transactions: [charge],
      occurrences: [occ({ targetKind: 'card', targetId: 'card1', month: '2026-10', status: 'skipped' })],
      from: '2026-10',
    })
    expect(row.state).toBe('skipped')
    expect(row.remaining).toBe(0)
    expect(row.timing).toBe('done')
  })

  it('geçmiş vadeli ödenmemiş ayı gecikmiş sayar', () => {
    const [row] = schedule({
      accounts: [card()],
      plans: [plan({ targetKind: 'card', targetId: 'card1', amount: 1_500 })],
      from: '2026-09',
    })
    expect(row.dueDate).toBe('2026-09-10')
    expect(row.timing).toBe('overdue')
    expect(row.daysLeft).toBe(-25)
  })

  it('takip başlangıcından önce açık satır üretmez, ödenmişi geçmiş olarak gösterir', () => {
    const p = plan({ targetKind: 'card', targetId: 'card1', amount: 1_000 })
    expect(schedule({ accounts: [card()], plans: [p], from: '2026-07' })).toEqual([])
    const [row] = schedule({ accounts: [card()], plans: [p], transactions: [cardPayment('old', '2026-07-09', 1_000)], from: '2026-07' })
    expect(row.state).toBe('paid')
    expect(row.outOfRange).toBe(true)
  })

  it('boş ekstre "borç yok" satırı olur', () => {
    const [row] = schedule({ accounts: [card()], from: '2026-10' })
    expect(row.amount).toBe(0)
    expect(row.state).toBe('clear')
    expect(row.timing).toBe('done')
  })

  it('takipten çıkarılmış hedef satır üretmez', () => {
    expect(schedule({ accounts: [card()], plans: [plan({ targetKind: 'card', targetId: 'card1', isActive: false })], from: '2026-10' })).toEqual([])
  })
})

describe('buildSchedule — borç', () => {
  it('kalan tutar tükenince aylar biter, son ay küçülür', () => {
    const rows = schedule({ debts: [debt({ paidAmount: 18_000 })], from: '2026-09', to: '2027-02' })
    expect(rows.map(r => [r.month, r.amount])).toEqual([
      ['2026-09', 5_000],
      ['2026-10', 5_000],
      ['2026-11', 2_000],
    ])
  })

  it('debtId\'li işlemi o ayın ödemesi sayar', () => {
    const rows = schedule({
      debts: [debt({ paidAmount: 5_000 })],
      transactions: [tx({ id: 'dp', date: '2026-09-14', amount: 5_000, type: 'transfer', debtId: 'debt1' })],
      from: '2026-09',
      to: '2026-10',
    })
    expect(rows.map(r => [r.month, r.state])).toEqual([['2026-09', 'paid'], ['2026-10', 'open']])
    expect(rows[1].amount).toBe(5_000)
  })

  it('kapanmış borç açık satır üretmez', () => {
    expect(schedule({ debts: [debt({ paidAmount: 30_000, isSettled: true })], from: '2026-10', to: '2026-12' })).toEqual([])
  })

  it('taksit sayısı bitince satır üretmez', () => {
    const rows = schedule({ debts: [debt({ totalInstallments: 2, totalAmount: 100_000 })], from: '2026-09', to: '2026-12' })
    expect(rows.map(r => r.month)).toEqual(['2026-09', '2026-10'])
  })

  it('aylık tutarı olmayan borç "tutar yok" satırı üretir', () => {
    const [row] = schedule({ debts: [debt({ monthlyPayment: undefined, totalInstallments: undefined })], from: '2026-10' })
    expect(row.amount).toBeNull()
    expect(row.state).toBe('open')
  })
})

describe('summarizeRows', () => {
  it('ödenen, kalan, gecikmiş ve sıradakini toplar', () => {
    const rows = schedule({
      accounts: [card(), card({ id: 'card2', name: 'Axess', dueDay: 20 })],
      debts: [debt()],
      plans: [
        plan({ targetKind: 'card', targetId: 'card1', amount: 2_000, dayOfMonth: 1 }),
        plan({ targetKind: 'card', targetId: 'card2', amount: 1_000 }),
      ],
      transactions: [tx({ id: 'dp', date: '2026-10-02', amount: 5_000, type: 'transfer', debtId: 'debt1' })],
      from: '2026-10',
    })
    const s = summarizeRows(rows)
    expect(s.count).toBe(3)
    expect(s.totalTry).toBe(8_000)
    expect(s.paidTry).toBe(5_000)
    expect(s.remainingTry).toBe(3_000)
    expect(s.overdueCount).toBe(1)   // card1 — 1 Ekim
    expect(s.overdueTry).toBe(2_000)
    expect(s.next?.target.id).toBe('card2')
  })
})
