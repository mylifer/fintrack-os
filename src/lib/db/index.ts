import Dexie, { type EntityTable } from 'dexie'
import type { Account, Transaction, Category, Budget, Debt, InvestmentTransaction, Person } from '@/types'

class FinTrackDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  debts!: EntityTable<Debt, 'id'>
  investmentTransactions!: EntityTable<InvestmentTransaction, 'id'>
  people!: EntityTable<Person, 'id'>

  constructor() {
    super('fintrack-os')

    this.version(1).stores({
      accounts:     '&id, type, currency, isArchived',
      transactions: '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId',
      categories:   '&id, scope, parentId, isSystem',
      budgets:      '&id, categoryId, period, year, month',
      debts:        '&id, type, direction, isSettled, dueDate',
    })

    this.version(2).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId',
      categories:             '&id, scope, parentId, isSystem',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
    })

    // v3: introduce initialBalance. Compute it from current balance minus all transaction effects.
    // Going forward, balance is derived at runtime; initialBalance is the only persisted value.
    this.version(3).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId',
      categories:             '&id, scope, parentId, isSystem',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
    }).upgrade(async (trans) => {
      const accounts: Account[] = await trans.table('accounts').toArray()
      const allTxs: Transaction[] = await trans.table('transactions').toArray()

      for (const account of accounts) {
        const effect = allTxs.reduce((sum, t) => {
          if (t.type === 'transfer') {
            if (t.accountId === account.id) return sum - t.amount
            if (t.toAccountId === account.id) return sum + t.amount
          } else if (t.accountId === account.id) {
            return sum + (t.type === 'income' ? t.amount : -t.amount)
          }
          return sum
        }, 0)
        await trans.table('accounts').update(account.id, { initialBalance: account.balance - effect })
      }
    })

    // v4: add people table (family members & recipients) and index new transaction fields
    this.version(4).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId',
      categories:             '&id, scope, parentId, isSystem',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
      people:                 '&id, role',
    })
  }
}

export const db = new FinTrackDB()
