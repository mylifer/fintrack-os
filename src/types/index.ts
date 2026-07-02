// ─── Shared ────────────────────────────────────────────────────────────────

export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP'

export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all'

// ─── Account ───────────────────────────────────────────────────────────────

export type AccountType =
  | 'cash'
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'investment'
  | 'loan'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: CurrencyCode
  balance: number           // Computed at runtime: initialBalance + sum(transactions). Never persisted directly.
  initialBalance: number    // User-set starting balance stored in DB. Code never mutates this.
  color: string             // Hex, e.g. "#1A5CA3"
  icon?: string             // Emoji
  isArchived: boolean
  createdAt: string         // ISO 8601

  // Credit card fields
  creditLimit?: number
  statementDay?: number     // 1–28: billing cycle close day
  dueDay?: number           // Payment due day after statement
  minPayPct?: number        // Minimum payment % (default: 3)
}

// ─── Person ────────────────────────────────────────────────────────────────

export type PersonRole = 'family_member' | 'recipient'

export interface Person {
  id: string
  name: string
  role: PersonRole
  url?: string
  createdAt: string
}

// ─── Transaction ───────────────────────────────────────────────────────────

export type TransactionType = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: string
  type: TransactionType
  amount: number            // Always positive; direction from type
  currency: CurrencyCode
  date: string              // ISO 8601 date: "2026-06-21"
  accountId: string
  toAccountId?: string      // Transfer target
  categoryId?: string
  icon?: string             // Override icon when no category (e.g. investment linked txs)
  description: string
  notes?: string
  tags?: string[]
  merchant?: string         // Normalized merchant name

  // Optional people tags (null = explicitly cleared when editing)
  familyMemberId?: string | null
  recipientId?: string | null

  // Installment
  isInstallment: boolean
  installTotal?: number     // Total installment count
  installIndex?: number     // Current position (1-based)
  installGroupId?: string   // Groups all installments of one purchase

  debtId?: string           // Links to a tracked Debt
  createdAt: string
  updatedAt: string
}

// ─── Category ──────────────────────────────────────────────────────────────

export type CategoryScope = 'expense' | 'income'

export interface Category {
  id: string
  name: string
  icon: string              // Emoji: "🛒", "🚗", "🏠"
  color: string             // Hex
  scope: CategoryScope
  parentId?: string         // Supports up to 3 levels deep
  isSystem: boolean         // Cannot be deleted
  sortOrder: number
}

// ─── Budget ────────────────────────────────────────────────────────────────

export type BudgetPeriod = 'monthly' | 'quarterly' | 'yearly'
export type BudgetStatus = 'ok' | 'warning' | 'exceeded'

export interface Budget {
  id: string
  categoryId: string
  amount: number            // Planned spending limit
  period: BudgetPeriod
  year?: number             // Legacy; ignored — budgets now apply to all months
  month?: number            // Legacy; ignored — budgets now apply to all months
  rollover: boolean         // Carry unused budget forward
  alertThreshold: number    // Warn at X% (default: 80)
}

export interface BudgetWithSpent extends Budget {
  spent: number
  remaining: number
  percentUsed: number
  status: BudgetStatus
  category?: Category
}

// ─── Debt ──────────────────────────────────────────────────────────────────

export type DebtType =
  | 'personal'
  | 'bank_loan'
  | 'credit_card_debt'
  | 'installment'

export type DebtDirection = 'owe' | 'owed'

export interface Debt {
  id: string
  name: string              // "Araba Kredisi", "Ahmet'e Borç"
  type: DebtType
  direction: DebtDirection  // 'owe' = I owe; 'owed' = owed to me
  totalAmount: number
  paidAmount: number        // Running total of payments
  interestRate?: number     // Annual % (e.g., 3.5)
  startDate: string
  dueDate?: string          // Next payment / final maturity
  monthlyPayment?: number
  totalInstallments?: number
  paidInstallments?: number
  counterparty?: string     // "Garanti BBVA", "Ahmet Yılmaz"
  accountId?: string        // Account payments are drawn from
  notes?: string
  isSettled: boolean
  createdAt: string
}

export interface DebtWithRemaining extends Debt {
  remainingAmount: number
  progressPercent: number
}

// ─── UI Store ──────────────────────────────────────────────────────────────

export type ModalType =
  | 'add-transaction'
  | 'edit-transaction'
  | 'add-account'
  | 'edit-account'
  | 'add-budget'
  | 'edit-budget'
  | 'add-debt'
  | 'edit-debt'
  | 'add-category'
  | null

export interface ModalPayload {
  id?: string
  type?: TransactionType
  accountId?: string
}

export interface MonthYear {
  month: number   // 1–12
  year: number
}

// ─── Filters ───────────────────────────────────────────────────────────────

export interface TransactionFilters {
  accountIds?: string[]
  categoryIds?: string[]
  types?: TransactionType[]
  dateFrom?: string
  dateTo?: string
  search?: string
  familyMemberIds?: string[]
  recipientIds?: string[]
}

// ─── Investment ────────────────────────────────────────────────────────────

export type InvestmentAsset =
  | 'GOLD_GRAM'
  | 'GOLD_QUARTER'
  | 'GOLD_HALF'
  | 'GOLD_FULL'
  | 'GOLD_OZ'
  | 'USD'
  | 'EUR'
  | 'GBP'

export interface InvestmentTransaction {
  id: string
  type: 'buy' | 'sell'
  asset: InvestmentAsset
  quantity: number        // amount of asset units
  pricePerUnit: number    // TRY per unit at transaction time
  sourceAccountId?: string  // buy: account to debit from (optional)
  targetAccountId?: string  // sell: account to credit to (optional)
  linkedTransactionId?: string // id of the linked transaction in transactions table
  date: string            // ISO 8601 date
  note?: string
  createdAt: string
}

export interface PriceData {
  usdTry: number       // 1 USD = X TRY
  eurTry: number       // 1 EUR = X TRY
  gbpTry: number       // 1 GBP = X TRY
  goldGramTry: number  // 1 gram gold = X TRY
  // Previous day close — optional (absent if yesterday fetch failed)
  prevUsdTry?: number
  prevEurTry?: number
  prevGbpTry?: number
  prevGoldGramTry?: number
  updatedAt: number    // Date.now()
}

export interface InvestmentHolding {
  asset: InvestmentAsset
  quantity: number
  avgCostPerUnit: number
  totalCost: number
  currentPrice: number
  currentValue: number
  pnl: number
  pnlPercent: number
}

// ─── Recurring Transaction ─────────────────────────────────────────────────

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurringTransaction {
  id: string
  name: string              // Human label: "Kira", "Netflix", "Maaş"
  type: TransactionType
  amount: number
  currency: CurrencyCode
  accountId: string
  toAccountId?: string      // Transfer target
  categoryId?: string
  description: string       // Description copied to generated transaction
  notes?: string
  frequency: RecurringFrequency
  dayOfMonth?: number       // 1–28, meaningful for monthly/yearly
  monthOfYear?: number      // 1–12, meaningful for yearly
  startDate: string         // ISO date — first occurrence
  endDate?: string          // Optional end date
  nextDueDate: string       // Date of the next generation
  lastGeneratedDate?: string
  isActive: boolean
  familyMemberId?: string
  recipientId?: string
  createdAt: string
}

// ─── Default categories ────────────────────────────────────────────────────

// _parentName: resolved to parentId during initDefaults — stripped before DB insert
export type DefaultCategoryDef = Omit<Category, 'id'> & { _parentName?: string }

export const DEFAULT_CATEGORIES: DefaultCategoryDef[] = [
  // ── Gider: üst kategoriler ────────────────────────────────────────────────
  { name: 'Yemek',             icon: 'tools-kitchen-2',  color: '#F97316', scope: 'expense', isSystem: true, sortOrder:  1 },
  { name: 'Market',            icon: 'shopping-cart',    color: '#10B981', scope: 'expense', isSystem: true, sortOrder:  2 },
  { name: 'Kahve ve Cafe',     icon: 'coffee',           color: '#F59E0B', scope: 'expense', isSystem: true, sortOrder:  3 },
  { name: 'Ulaşım',            icon: 'car',              color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder:  4 },
  { name: 'Ev',                icon: 'home',             color: '#EAB308', scope: 'expense', isSystem: true, sortOrder:  5 },
  { name: 'Alışveriş',         icon: 'shopping-bag',     color: '#EC4899', scope: 'expense', isSystem: true, sortOrder:  6 },
  { name: 'Faturalar',         icon: 'receipt',          color: '#F97316', scope: 'expense', isSystem: true, sortOrder:  7 },
  { name: 'Abonelikler',       icon: 'refresh',          color: '#8B5CF6', scope: 'expense', isSystem: true, sortOrder:  8 },
  { name: 'Sağlık',            icon: 'building-hospital',color: '#EF4444', scope: 'expense', isSystem: true, sortOrder:  9 },
  { name: 'Sigorta',           icon: 'shield',           color: '#64748B', scope: 'expense', isSystem: true, sortOrder: 10 },
  { name: 'Yatırım',           icon: 'trending-up',      color: '#6366F1', scope: 'expense', isSystem: true, sortOrder: 11 },
  { name: 'Vergi',             icon: 'scale',            color: '#78716C', scope: 'expense', isSystem: true, sortOrder: 12 },
  { name: 'Banka Giderleri',   icon: 'building-bank',    color: '#1D4ED8', scope: 'expense', isSystem: true, sortOrder: 13 },
  { name: 'Şarj',              icon: 'bolt',             color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 14 },
  { name: 'Legal',             icon: 'scale',            color: '#6B7280', scope: 'expense', isSystem: true, sortOrder: 15 },
  { name: 'Çeşitli Hizmetler', icon: 'tool',             color: '#6B7280', scope: 'expense', isSystem: true, sortOrder: 16 },
  { name: 'Tütün',             icon: 'smoking',          color: '#78716C', scope: 'expense', isSystem: true, sortOrder: 17 },
  { name: 'Duty Free',         icon: 'plane',            color: '#0EA5E9', scope: 'expense', isSystem: true, sortOrder: 18 },
  { name: 'Kişisel Bakım',     icon: 'sparkles',         color: '#EC4899', scope: 'expense', isSystem: true, sortOrder: 19 },
  { name: 'Araç Yıkama',       icon: 'droplet',          color: '#06B6D4', scope: 'expense', isSystem: true, sortOrder: 20 },
  { name: 'Alkol',             icon: 'beer',             color: '#F59E0B', scope: 'expense', isSystem: true, sortOrder: 21 },
  { name: 'Kırtasiye',         icon: 'pencil',           color: '#6366F1', scope: 'expense', isSystem: true, sortOrder: 22 },
  { name: 'Yazılım',           icon: 'device-desktop',   color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 23 },
  { name: 'Diğer Gider',       icon: 'package',          color: '#6B7280', scope: 'expense', isSystem: true, sortOrder: 24 },

  // ── Gider: Ulaşım alt kategorileri ───────────────────────────────────────
  { name: 'HGS',               icon: 'road',             color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 41, _parentName: 'Ulaşım' },
  { name: 'Otopark',           icon: 'parking',          color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 42, _parentName: 'Ulaşım' },
  { name: 'Taksi',             icon: 'car',              color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 43, _parentName: 'Ulaşım' },
  { name: 'Otomobil Bakım',    icon: 'tool',             color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 44, _parentName: 'Ulaşım' },
  { name: 'Yakıt',             icon: 'gas-station',      color: '#3B82F6', scope: 'expense', isSystem: true, sortOrder: 45, _parentName: 'Ulaşım' },

  // ── Gider: Ev alt kategorileri ────────────────────────────────────────────
  { name: 'Mobilya',           icon: 'sofa',             color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 51, _parentName: 'Ev' },
  { name: 'Tadilat',           icon: 'hammer',           color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 52, _parentName: 'Ev' },
  { name: 'Kira',              icon: 'key',              color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 53, _parentName: 'Ev' },
  { name: 'Mutfak',            icon: 'tools-kitchen-2',  color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 54, _parentName: 'Ev' },
  { name: 'Elektronik',        icon: 'device-tv',        color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 55, _parentName: 'Ev' },
  { name: 'Temizlik',          icon: 'spray',            color: '#EAB308', scope: 'expense', isSystem: true, sortOrder: 56, _parentName: 'Ev' },

  // ── Gider: Alışveriş alt kategorileri ────────────────────────────────────
  { name: 'Teknoloji',         icon: 'device-laptop',    color: '#EC4899', scope: 'expense', isSystem: true, sortOrder: 61, _parentName: 'Alışveriş' },
  { name: 'Giyim',             icon: 'hanger',           color: '#EC4899', scope: 'expense', isSystem: true, sortOrder: 62, _parentName: 'Alışveriş' },

  // ── Gider: Faturalar alt kategorileri ─────────────────────────────────────
  { name: 'Aidat',             icon: 'building',         color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 71, _parentName: 'Faturalar' },
  { name: 'Doğalgaz',          icon: 'flame',            color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 72, _parentName: 'Faturalar' },
  { name: 'Mobil Hat',         icon: 'phone',            color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 73, _parentName: 'Faturalar' },
  { name: 'Su',                icon: 'droplet',          color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 74, _parentName: 'Faturalar' },
  { name: 'Elektrik',          icon: 'bolt',             color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 75, _parentName: 'Faturalar' },
  { name: 'İnternet',          icon: 'wifi',             color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 76, _parentName: 'Faturalar' },
  { name: 'Telefon',           icon: 'phone-call',       color: '#F97316', scope: 'expense', isSystem: true, sortOrder: 77, _parentName: 'Faturalar' },

  // ── Gelir kategorileri ────────────────────────────────────────────────────
  { name: 'Maaş',              icon: 'briefcase',        color: '#10B981', scope: 'income',  isSystem: true, sortOrder: 100 },
  { name: 'Cashback',          icon: 'arrow-up-right',   color: '#10B981', scope: 'income',  isSystem: true, sortOrder: 101 },
  { name: 'Yatırım Geliri',    icon: 'trending-up',      color: '#10B981', scope: 'income',  isSystem: true, sortOrder: 102 },
  { name: 'Kira Geliri',       icon: 'home',             color: '#10B981', scope: 'income',  isSystem: true, sortOrder: 103 },
  { name: 'Diğer Gelir',       icon: 'gift',             color: '#10B981', scope: 'income',  isSystem: true, sortOrder: 104 },
]
