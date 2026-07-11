import Dexie, { type EntityTable } from 'dexie'
import type { Account, Transaction, Category, Budget, Debt, InvestmentTransaction, Person, RecurringTransaction, OutboxEntry } from '@/types'
// Shared legacy→Tabler icon map (single source of truth). The v6 migration only
// ever encounters the noto: subset, but lookups are by exact key so the
// superset is harmless and correct. A plain module import is safe inside the
// Dexie upgrade callback below.
import { NOTO_TO_TABLER, LEGACY_COLOR } from '@/lib/legacy-icon-map'

class FinTrackDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  debts!: EntityTable<Debt, 'id'>
  investmentTransactions!: EntityTable<InvestmentTransaction, 'id'>
  people!: EntityTable<Person, 'id'>
  recurringTransactions!: EntityTable<RecurringTransaction, 'id'>
  _outbox!: EntityTable<OutboxEntry, 'id'>

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

    // v5: add recurringTransactions table
    this.version(5).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId',
      categories:             '&id, scope, parentId, isSystem',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
      people:                 '&id, role',
      recurringTransactions:  '&id, type, frequency, nextDueDate, isActive',
    })

    // v6: migrate noto: / legacy icons → Tabler + assign meaningful colors
    this.version(6).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId',
      categories:             '&id, scope, parentId, isSystem',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
      people:                 '&id, role',
      recurringTransactions:  '&id, type, frequency, nextDueDate, isActive',
    }).upgrade(async (trans) => {
      // ICON_MAP + OLD_DEFAULT_COLOR now come from the shared legacy-icon-map
      // (superset of the noto: entries this migration needs — exact-key lookup
      // makes the extra emoji/PascalCase entries harmless here).
      const cats: Category[] = await trans.table('categories').toArray()
      for (const cat of cats) {
        const mapped = NOTO_TO_TABLER[cat.icon]
        if (mapped) {
          const patch: Partial<Category> = { icon: mapped.icon }
          // Only update color if still at the old default
          if (cat.color === LEGACY_COLOR) patch.color = mapped.color
          await trans.table('categories').update(cat.id, patch)
        }
      }
    })

    // v7: add isArchived index on categories; backfill existing rows with isArchived: false
    this.version(7).stores({
      accounts:               '&id, type, currency, isArchived',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId',
      categories:             '&id, scope, parentId, isSystem, isArchived',
      budgets:                '&id, categoryId, period, year, month',
      debts:                  '&id, type, direction, isSettled, dueDate',
      investmentTransactions: '&id, type, asset, date',
      people:                 '&id, role',
      recurringTransactions:  '&id, type, frequency, nextDueDate, isActive',
    }).upgrade(async (trans) => {
      await trans.table('categories').toCollection().modify({ isArchived: false })
    })

    // v8: tombstones (C3). Add an indexed `deleted_at` soft-delete marker to
    // every synced table. No data transform needed — existing rows have an
    // undefined deleted_at, which reads as "live" everywhere.
    this.version(8).stores({
      accounts:               '&id, type, currency, isArchived, deleted_at',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId, deleted_at',
      categories:             '&id, scope, parentId, isSystem, isArchived, deleted_at',
      budgets:                '&id, categoryId, period, year, month, deleted_at',
      debts:                  '&id, type, direction, isSettled, dueDate, deleted_at',
      investmentTransactions: '&id, type, asset, date, deleted_at',
      people:                 '&id, role, deleted_at',
      recurringTransactions:  '&id, type, frequency, nextDueDate, isActive, deleted_at',
    })

    // v9: durable sync outbox (C1). `_outbox` holds one pending mutation per
    // (table, entity), pushed to Supabase by the background sync engine and
    // removed only on server ACK. Indexed by `table` (reconciling-pull guard)
    // and `enqueuedAt` (stable FK-safe flush order).
    this.version(9).stores({
      accounts:               '&id, type, currency, isArchived, deleted_at',
      transactions:           '&id, type, accountId, toAccountId, categoryId, date, installGroupId, debtId, familyMemberId, recipientId, deleted_at',
      categories:             '&id, scope, parentId, isSystem, isArchived, deleted_at',
      budgets:                '&id, categoryId, period, year, month, deleted_at',
      debts:                  '&id, type, direction, isSettled, dueDate, deleted_at',
      investmentTransactions: '&id, type, asset, date, deleted_at',
      people:                 '&id, role, deleted_at',
      recurringTransactions:  '&id, type, frequency, nextDueDate, isActive, deleted_at',
      _outbox:                '&id, table, entityId, enqueuedAt',
    })
  }
}

export const db = new FinTrackDB()
