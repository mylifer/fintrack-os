import { describe, it, expect } from 'vitest'
import type { Account, PaymentPlan, Transaction } from '@/types'
import { assignCardPayments, buildSchedule, buildTargets, isCardPaymentText, planIdFor } from './schedule'

/* ────────────────────────────────────────────────────────────────────────
   Kart ödemesi tespiti (kullanıcı isteği, 2026-09-11): geçmiş tarihli
   "Kredi Kartı Ödemesi" kayıtları otomatik bulunup Yıllık Plan'a işlensin.

   Değişmez: belirsiz kayıt (hangi karta ait olduğu bilinmeyen) HİÇBİR karta
   yazılmaz — varsayım yapılmaz.
──────────────────────────────────────────────────────────────────────── */

const TODAY = '2026-09-11'

function acc(p: Partial<Account> & Pick<Account, 'id' | 'name' | 'type'>): Account {
  return {
    currency: 'TRY', balance: 0, initialBalance: 0, color: '#000', isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z', ...p,
  }
}

function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount'>): Transaction {
  return {
    type: 'expense', currency: 'TRY', accountId: 'chk', description: 'x', isInstallment: false,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...p,
  }
}

const chk = acc({ id: 'chk', name: 'Vadesiz Hesap', type: 'checking' })
const bonus = acc({ id: 'bonus', name: 'Garanti Bonus', type: 'credit_card' })
const axess = acc({ id: 'axess', name: 'Akbank Axess', type: 'credit_card' })

const ids = (m: Map<string, Transaction[]>, card: string) => (m.get(card) ?? []).map(t => t.id)

describe('isCardPaymentText', () => {
  it('büyük/küçük harf ve Türkçe karakterden bağımsız tanır', () => {
    expect(isCardPaymentText('Kredi Kartı Ödemesi')).toBe(true)
    expect(isCardPaymentText('kredi karti odemesi')).toBe(true)
    expect(isCardPaymentText('KREDİ KARTI ÖDEME')).toBe(true)
    expect(isCardPaymentText('Kredi Kartı Ödemesi - Bonus')).toBe(true)
    expect(isCardPaymentText('Kredi kart ödemesi')).toBe(true)
  })

  it('ilgisiz açıklamaları tanımaz', () => {
    expect(isCardPaymentText('Market')).toBe(false)
    expect(isCardPaymentText('Kredi Kartı Aidatı')).toBe(false)
    expect(isCardPaymentText(undefined)).toBe(false)
  })
})

describe('assignCardPayments', () => {
  it('karta transfer açıklamadan bağımsız o kartın ödemesidir', () => {
    const m = assignCardPayments([chk, bonus, axess], [
      tx({ id: 't1', date: '2026-08-10', amount: 500, type: 'transfer', toAccountId: 'bonus', description: 'Aktarım' }),
    ])
    expect(ids(m, 'bonus')).toEqual(['t1'])
  })

  it('başka hesaba giden "Kredi Kartı Ödemesi" transferi kart ödemesi değildir', () => {
    const m = assignCardPayments([chk, bonus, acc({ id: 'sav', name: 'Birikim', type: 'savings' })], [
      tx({ id: 't1', date: '2026-08-10', amount: 500, type: 'transfer', toAccountId: 'sav', description: 'Kredi Kartı Ödemesi' }),
    ])
    expect(m.size).toBe(0)
  })

  it('nakit hesaptan "Kredi Kartı Ödemesi" tek kart varsa o karta yazılır', () => {
    const m = assignCardPayments([chk, bonus], [
      tx({ id: 't1', date: '2026-08-10', amount: 500, description: 'Kredi Kartı Ödemesi' }),
    ])
    expect(ids(m, 'bonus')).toEqual(['t1'])
  })

  it('birden fazla kart varken ad geçmiyorsa HİÇBİR karta yazılmaz', () => {
    const m = assignCardPayments([chk, bonus, axess], [
      tx({ id: 't1', date: '2026-08-10', amount: 500, description: 'Kredi Kartı Ödemesi' }),
    ])
    expect(m.size).toBe(0)
  })

  it('açıklamada ya da notta kart adı geçiyorsa o karta yazılır', () => {
    const m = assignCardPayments([chk, bonus, axess], [
      tx({ id: 't1', date: '2026-08-10', amount: 500, description: 'Kredi Kartı Ödemesi - Akbank Axess' }),
      tx({ id: 't2', date: '2026-08-11', amount: 700, description: 'Kredi Kartı Ödemesi', notes: 'garanti bonus' }),
    ])
    expect(ids(m, 'axess')).toEqual(['t1'])
    expect(ids(m, 'bonus')).toEqual(['t2'])
  })

  it('kartın kendi hesabına gelir olarak işlenmiş ödeme o kartındır; kart harcaması değildir', () => {
    const m = assignCardPayments([chk, bonus, axess], [
      tx({ id: 'in', date: '2026-08-10', amount: 500, type: 'income', accountId: 'axess', description: 'Kredi kartı ödemesi' }),
      tx({ id: 'ex', date: '2026-08-10', amount: 500, type: 'expense', accountId: 'axess', description: 'Kredi kartı ödemesi' }),
    ])
    expect(ids(m, 'axess')).toEqual(['in'])
  })

  it('borç ödemesi (debtId) ve nakit hesaba giren para kart ödemesi sayılmaz', () => {
    const m = assignCardPayments([chk, bonus], [
      tx({ id: 'd', date: '2026-08-10', amount: 500, type: 'transfer', debtId: 'x', description: 'Kredi Kartı Ödemesi' }),
      tx({ id: 'i', date: '2026-08-10', amount: 500, type: 'income', description: 'Kredi Kartı Ödemesi' }),
    ])
    expect(m.size).toBe(0)
  })

  it('arşivli kartın adı geçen ödeme aktif karta kaymaz; kart eklenmeden önceki kayıt yazılmaz', () => {
    const old = acc({ id: 'old', name: 'Eski World', type: 'credit_card', isArchived: true })
    const late = acc({ id: 'late', name: 'Yeni Kart', type: 'credit_card', createdAt: '2026-08-01T00:00:00.000Z' })
    const m = assignCardPayments([chk, old, late], [
      tx({ id: 'o', date: '2026-08-10', amount: 500, description: 'Kredi Kartı Ödemesi Eski World' }),
      tx({ id: 'early', date: '2026-07-10', amount: 500, description: 'Kredi Kartı Ödemesi' }),
      tx({ id: 'ok', date: '2026-08-10', amount: 500, description: 'Kredi Kartı Ödemesi' }),
    ])
    expect(m.has('old')).toBe(false)
    expect(ids(m, 'late')).toEqual(['ok'])
  })
})

describe('buildSchedule — geçmiş kart ödemeleri', () => {
  const plan: PaymentPlan = {
    id: planIdFor('card', 'bonus'), targetKind: 'card', targetId: 'bonus', dayOfMonth: 15,
    isActive: true, createdAt: TODAY, updatedAt: TODAY,
  }

  it('takip başlangıcından önceki aylarda bulunan ödemeler tutarıyla ödendi olarak görünür', () => {
    const accounts = [chk, bonus]
    const transactions = [
      tx({ id: 'jun', date: '2026-06-14', amount: 4_100, type: 'transfer', toAccountId: 'bonus', description: 'Kredi Kartı Ödemesi' }),
      tx({ id: 'aug', date: '2026-08-13', amount: 6_800, description: 'Kredi Kartı Ödemesi' }),
    ]
    const targets = buildTargets({ accounts, debts: [], plans: [plan] })
    const rows = buildSchedule({
      targets, occurrences: [], transactions, from: '2026-06', to: '2026-09', todayStr: TODAY,
      cardPayments: assignCardPayments(accounts, transactions),
    })
    expect(rows.map(r => [r.month, r.state, r.paidAmount, r.outOfRange])).toEqual([
      ['2026-06', 'paid', 4_100, true],
      ['2026-08', 'paid', 6_800, true],
      ['2026-09', 'open', 0, false],
    ])
  })

  it('filtrelenmiş hedef listesinde tüm hesaplardan hesaplanan eşleme kullanılır', () => {
    // Axess takip dışı bırakılsa bile "tek kart" sayılmaz: iki kart var → belirsiz ödeme yazılmaz.
    const accounts = [chk, bonus, axess]
    const transactions = [tx({ id: 'amb', date: '2026-08-13', amount: 1_000, description: 'Kredi Kartı Ödemesi' })]
    const targets = buildTargets({ accounts, debts: [], plans: [plan] }).filter(t => t.id === 'bonus')
    const rows = buildSchedule({
      targets, occurrences: [], transactions, from: '2026-08', to: '2026-08', todayStr: TODAY,
      cardPayments: assignCardPayments(accounts, transactions),
    })
    expect(rows).toEqual([])
  })
})
