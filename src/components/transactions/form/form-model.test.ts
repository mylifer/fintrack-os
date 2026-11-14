import { describe, it, expect } from 'vitest'
import {
  toAmountStr, formatTurkishDisplay, newForm, formForNextEntry, buildInitialForm,
  buildSuggestions, validateTransactionForm, newRecurringForm, type ValidateInput,
} from './form-model'
import type { Account, Transaction } from '@/types'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1', type: 'expense', amount: 1000, currency: 'TRY', date: '2026-08-16',
  accountId: 'a1', description: 'Market', isInstallment: false,
  createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
})

describe('toAmountStr / formatTurkishDisplay', () => {
  it('sayıyı ham virgüllü biçime çevirir (gruplama yok, en çok 2 ondalık)', () => {
    expect(toAmountStr(500.5)).toBe('500,5')
    expect(toAmountStr(1250)).toBe('1250')
    expect(toAmountStr(12.345)).toBe('12,35')
  })
  it('görüntüde binlik ayırıcı nokta ekler, ondalık kısmı korur', () => {
    expect(formatTurkishDisplay('')).toBe('0')
    expect(formatTurkishDisplay('1250,50')).toBe('1.250,50')
    expect(formatTurkishDisplay('1234567')).toBe('1.234.567')
    expect(formatTurkishDisplay('12,')).toBe('12,')
  })
})

describe('formForNextEntry', () => {
  it('yalnızca tip, hesap ve tarihi taşır; gerisi boş formdur', () => {
    const f = formForNextEntry('income', 'a2', '2026-01-02')
    expect(f).toEqual({ ...newForm(), type: 'income', accountId: 'a2', date: '2026-01-02' })
    expect(f.amount).toBe(0)
    expect(f.tags).toEqual([])
  })
})

describe('buildInitialForm', () => {
  it('düzenlemede işlemden tohumlanır; borç bağı olmayan transfer borç ödemesi sayılmaz', () => {
    const f = buildInitialForm(true, tx({ type: 'transfer', toAccountId: 'a2', tags: ['x'] }), undefined, null)
    expect(f).toMatchObject({ type: 'transfer', amount: 1000, accountId: 'a1', toAccountId: 'a2', tags: ['x'], isDebtPayment: false, debtId: undefined })
  })
  it('hedef hesapsız borçlu transfer borç ödemesidir', () => {
    const f = buildInitialForm(true, tx({ type: 'transfer', debtId: 'd1' }), undefined, null)
    expect(f.isDebtPayment).toBe(true)
    expect(f.debtId).toBe('d1')
  })
  it('yeni kayıtta modal yükündeki hesabı önceden seçer', () => {
    const f = buildInitialForm(false, undefined, undefined, { accountId: 'a9' })
    expect(f.accountId).toBe('a9')
    expect(f.type).toBe('expense')
  })
})

describe('buildSuggestions', () => {
  const accounts = [{ id: 'a1' }, { id: 'a2' }]
  it('aynı açıklamada en son kaydedilen/düzenlenen satır kazanır (işlem tarihi değil)', () => {
    const s = buildSuggestions([
      tx({ id: '1', description: 'Migros', categoryId: 'old', date: '2026-09-01', updatedAt: '2026-08-01T00:00:00.000Z' }),
      tx({ id: '2', description: ' migros ', categoryId: 'new', date: '2026-07-01', updatedAt: '2026-08-10T00:00:00.000Z' }),
    ], 'expense', accounts)
    expect(s).toEqual([{ description: 'migros', categoryId: 'new', familyMemberId: undefined, recipientId: undefined, toAccountId: undefined, tags: undefined }])
  })
  it('yalnız sekmenin tipindeki satırlar; olmayan hedef hesap taşınmaz', () => {
    const s = buildSuggestions([
      tx({ id: '1', type: 'transfer', description: 'Birikim', toAccountId: 'a2' }),
      tx({ id: '2', type: 'transfer', description: 'Eski', toAccountId: 'silinmis' }),
      tx({ id: '3', type: 'expense', description: 'Market' }),
    ], 'transfer', accounts)
    expect(s.map(x => [x.description, x.toAccountId])).toEqual([['Birikim', 'a2'], ['Eski', undefined]])
  })
})

describe('validateTransactionForm', () => {
  const base = (over: Partial<ValidateInput> = {}): ValidateInput => ({
    amountStr: '100', form: { ...newForm(), accountId: 'a1', categoryId: 'c1', description: 'Market', date: '2026-08-16' },
    tab: 'expense', isCollection: false, splits: null, isInterest: false, taxRate: 0,
    selectedReceivable: undefined, receivableRemaining: 0, accounts: [{ id: 'a1', currency: 'TRY' } as Account],
    isRecurring: false, rec: newRecurringForm(), manualAmounts: null,
    ...over,
  })
  it('geçerli giderde hata yok', () => {
    expect(validateTransactionForm(base())).toEqual({})
  })
  it('tutar, hesap, kategori ve açıklama zorunlu', () => {
    const e = validateTransactionForm(base({ amountStr: '', form: { ...newForm(), date: '2026-08-16' } }))
    expect(Object.keys(e).sort()).toEqual(['accountId', 'amount', 'categoryId', 'description'])
  })
  it('transferde hedef hesap, borç modunda borç ister', () => {
    expect(validateTransactionForm(base({ tab: 'transfer' })).toAccountId).toBe('Hedef hesap seçin')
    const f = { ...base().form, isDebtPayment: true }
    expect(validateTransactionForm(base({ tab: 'transfer', form: f })).debtId).toBe('Borç seçin')
  })
  it('bölmede tekrarlanan kategori ve sıfır pay reddedilir', () => {
    expect(validateTransactionForm(base({ splits: [{ categoryId: 'a', amount: 50 }, { categoryId: 'a', amount: 50 }] })).categorySplits)
      .toBe('Aynı kategori birden fazla payda seçilemez')
    expect(validateTransactionForm(base({ splits: [{ categoryId: 'a', amount: 100 }, { categoryId: 'b', amount: 0 }] })).categorySplits)
      .toBe('Her payın tutarı 0’dan büyük olmalı')
  })
  it('tekrarlayan şablon ad ister, açıklama istemez', () => {
    const e = validateTransactionForm(base({ isRecurring: true, form: { ...base().form, description: '' } }))
    expect(e).toEqual({ name: 'Ad girin' })
  })
  it('taksit tutarlarından biri 0 ise hata verir', () => {
    const e = validateTransactionForm(base({ form: { ...base().form, isInstallment: true }, manualAmounts: ['100', '0'] }))
    expect(e.installments).toBe('Tüm taksit tutarları 0’dan büyük olmalı')
  })
})
