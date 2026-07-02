import Dexie, { type EntityTable } from 'dexie'
import type { Account, Transaction, Category, Budget, Debt, InvestmentTransaction, Person, RecurringTransaction } from '@/types'

class FinTrackDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  budgets!: EntityTable<Budget, 'id'>
  debts!: EntityTable<Debt, 'id'>
  investmentTransactions!: EntityTable<InvestmentTransaction, 'id'>
  people!: EntityTable<Person, 'id'>
  recurringTransactions!: EntityTable<RecurringTransaction, 'id'>

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
      const ICON_MAP: Record<string, { icon: string; color: string }> = {
        // Finans
        'noto:money-bag':                      { icon: 'moneybag',         color: '#6366F1' },
        'noto:credit-card':                    { icon: 'credit-card',      color: '#6366F1' },
        'noto:dollar-banknote':                { icon: 'cash',             color: '#6366F1' },
        'noto:chart-increasing':               { icon: 'trending-up',      color: '#6366F1' },
        'noto:bank':                           { icon: 'building-bank',    color: '#1D4ED8' },
        'noto:briefcase':                      { icon: 'briefcase',        color: '#10B981' },
        'noto:wrapped-gift':                   { icon: 'gift',             color: '#10B981' },
        'noto:red-heart':                      { icon: 'heart-handshake',  color: '#10B981' },
        'noto:receipt':                        { icon: 'receipt',          color: '#F97316' },
        'noto:money-with-wings':               { icon: 'arrow-up-right',   color: '#10B981' },
        'noto:balance-scale':                  { icon: 'scale',            color: '#78716C' },
        'noto:scales':                         { icon: 'scale',            color: '#6B7280' },
        'noto:package':                        { icon: 'package',          color: '#6B7280' },
        // Yemek
        'noto:fork-and-knife-with-plate':      { icon: 'tools-kitchen-2',  color: '#F97316' },
        'noto:shopping-cart':                  { icon: 'shopping-cart',    color: '#10B981' },
        'noto:hot-beverage':                   { icon: 'coffee',           color: '#F59E0B' },
        'noto:beer-mug':                       { icon: 'beer',             color: '#F59E0B' },
        'noto:fork-and-knife':                 { icon: 'tools-kitchen-2',  color: '#EAB308' },
        'noto:pizza':                          { icon: 'pizza',            color: '#F97316' },
        'noto:birthday-cake':                  { icon: 'cake',             color: '#F97316' },
        'noto:tropical-drink':                 { icon: 'bottle',           color: '#F97316' },
        // Ulaşım
        'noto:automobile':                     { icon: 'car',              color: '#3B82F6' },
        'noto:bus':                            { icon: 'bus',              color: '#3B82F6' },
        'noto:taxi':                           { icon: 'car',              color: '#3B82F6' },
        'noto:train':                          { icon: 'train',            color: '#3B82F6' },
        'noto:airplane':                       { icon: 'plane',            color: '#0EA5E9' },
        'noto:fuel-pump':                      { icon: 'gas-station',      color: '#3B82F6' },
        'noto:p-button':                       { icon: 'parking',          color: '#3B82F6' },
        'noto:motorway':                       { icon: 'road',             color: '#3B82F6' },
        'noto:bicycle':                        { icon: 'bike',             color: '#3B82F6' },
        'noto:ferry':                          { icon: 'sailboat',         color: '#3B82F6' },
        // Ev
        'noto:house':                          { icon: 'home',             color: '#EAB308' },
        'noto:key':                            { icon: 'key',              color: '#EAB308' },
        'noto:hammer':                         { icon: 'hammer',           color: '#EAB308' },
        'noto:wrench':                         { icon: 'tool',             color: '#6B7280' },
        'noto:high-voltage':                   { icon: 'bolt',             color: '#EAB308' },
        'noto:droplet':                        { icon: 'droplet',          color: '#06B6D4' },
        'noto:fire':                           { icon: 'flame',            color: '#F97316' },
        'noto:globe-with-meridians':           { icon: 'wifi',             color: '#F97316' },
        'noto:mobile-phone':                   { icon: 'phone',            color: '#F97316' },
        'noto:telephone-receiver':             { icon: 'phone-call',       color: '#F97316' },
        'noto:television':                     { icon: 'device-tv',        color: '#EAB308' },
        'noto:couch-and-lamp':                 { icon: 'sofa',             color: '#EAB308' },
        'noto:office-building':                { icon: 'building',         color: '#F97316' },
        'noto:sparkles':                       { icon: 'sparkles',         color: '#EC4899' },
        'noto:shield':                         { icon: 'shield',           color: '#64748B' },
        // Sağlık
        'noto:hospital':                       { icon: 'building-hospital',color: '#EF4444' },
        'noto:stethoscope':                    { icon: 'stethoscope',      color: '#EF4444' },
        'noto:pill':                           { icon: 'pill',             color: '#EF4444' },
        'noto:brain':                          { icon: 'brain',            color: '#EF4444' },
        'noto:tooth':                          { icon: 'dental',           color: '#EF4444' },
        'noto:baby':                           { icon: 'baby-carriage',    color: '#EF4444' },
        'noto:person-running':                 { icon: 'run',              color: '#EF4444' },
        'noto:dumbbell':                       { icon: 'barbell',          color: '#EF4444' },
        // Eğlence
        'noto:video-game':                     { icon: 'device-gamepad-2', color: '#A855F7' },
        'noto:musical-notes':                  { icon: 'music',            color: '#A855F7' },
        'noto:clapper-board':                  { icon: 'movie',            color: '#A855F7' },
        'noto:books':                          { icon: 'book',             color: '#A855F7' },
        'noto:ticket':                         { icon: 'ticket',           color: '#A855F7' },
        'noto:headphone':                      { icon: 'headphones',       color: '#A855F7' },
        'noto:camera':                         { icon: 'camera',           color: '#A855F7' },
        'noto:party-popper':                   { icon: 'confetti',         color: '#A855F7' },
        'noto:sun':                            { icon: 'sun',              color: '#A855F7' },
        // Alışveriş
        'noto:shopping-bags':                  { icon: 'shopping-bag',     color: '#EC4899' },
        'noto:t-shirt':                        { icon: 'hanger',           color: '#EC4899' },
        'noto:laptop-computer':                { icon: 'device-laptop',    color: '#EC4899' },
        'noto:desktop-computer':               { icon: 'device-desktop',   color: '#3B82F6' },
        'noto:pencil':                         { icon: 'pencil',           color: '#6366F1' },
        'noto:lipstick':                       { icon: 'sparkles',         color: '#EC4899' },
        'noto:cigarette':                      { icon: 'smoking',          color: '#78716C' },
        'noto:ring':                           { icon: 'diamond',          color: '#EC4899' },
        // Diğer
        'noto:graduation-cap':                 { icon: 'school',           color: '#6B7280' },
        'noto:star':                           { icon: 'star',             color: '#6B7280' },
        'noto:leaf-fluttering-in-wind':        { icon: 'leaf',             color: '#6B7280' },
        'noto:counterclockwise-arrows-button': { icon: 'refresh',          color: '#8B5CF6' },
      }

      const OLD_DEFAULT_COLOR = '#6B8F80'

      const cats: Category[] = await trans.table('categories').toArray()
      for (const cat of cats) {
        const mapped = ICON_MAP[cat.icon]
        if (mapped) {
          const patch: Partial<Category> = { icon: mapped.icon }
          // Only update color if still at the old default
          if (cat.color === OLD_DEFAULT_COLOR) patch.color = mapped.color
          await trans.table('categories').update(cat.id, patch)
        }
      }
    })
  }
}

export const db = new FinTrackDB()
