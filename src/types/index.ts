// ─── Shared ────────────────────────────────────────────────────────────────

export type CurrencyCode = 'TRY' | 'USD' | 'EUR' | 'GBP'

export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all'

// ─── Workspace (Çalışma Alanı) ──────────────────────────────────────────────
// Aynı kullanıcıya bağlı, birbirini etkilemeyen birden fazla bütçe/hesap alanı.
// Kendisi bir workspaceId TAŞIMAZ — diğer tüm entity'lerin bölümleme eksenidir.
// Legacy entity'ler (bu özellikten önce oluşturulmuş) workspaceId'siz kalır ve
// istemci tarafında isDefault=true olan çalışma alanına ait sayılır.

export interface Workspace {
  id: string
  name: string
  isDefault: boolean
  createdAt: string         // ISO 8601
  deleted_at?: string | null // Tombstone (C3)
}

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
  deleted_at?: string | null // Tombstone (C3): ISO 8601 when soft-deleted, else null/undefined
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır

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
  isArchived?: boolean       // Archive (soft-hide): linked transactions keep resolving the name
  deleted_at?: string | null // Tombstone (C3) — legacy hard-remove path; new deletes archive instead
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
}

// ─── Transaction ───────────────────────────────────────────────────────────

export type TransactionType = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: string
  type: TransactionType
  amount: number            // In `currency`; direction from type (negative for refunds)
  amountTry?: number        // Base-currency (TRY) snapshot at write time (S2/S3). Aggregators sum THIS.
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
  refundOfId?: string       // Set on refund entries → the original transaction they offset (S4)
  systemKind?: 'reconciliation' // First-class marker for system ghost entries (S7); see reconciliation.ts

  // Onay kapısı (bildirim merkezi): null/undefined = legacy satır, tarihi gelince
  // otomatik post olur (mevcut veriler böyle kalır). 'pending' = tarihi gelse bile
  // bakiyeye girmez, bildirim merkezinde onay bekler. 'approved' = onaylandı,
  // normal post kuralı işler. Supabase sütunları: "approvalStatus" / "approvedAt".
  approvalStatus?: 'pending' | 'approved' | null
  approvedAt?: string | null
  createdAt: string
  updatedAt: string
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır

  // Çalışma alanları arası transfer: kaynak alanda 'expense', hedef alanda
  // 'income' olarak iki bağımsız satır, ortak workspaceTransferId ile
  // eşleştirilir. peerWorkspaceId karşı bacağın hangi alanda olduğunu taşır
  // (UI rozeti/gösterimi için — okuma yolunu değiştirmez).
  workspaceTransferId?: string
  peerWorkspaceId?: string
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
  isArchived?: boolean      // Soft-deleted; hidden from pickers but kept for historical data
  sortOrder: number
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
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
  categoryName?: string     // display-name snapshot; shown as "<name> (arşiv)" when the live category is gone
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
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
  startDate: string         // First installment date (vade yoksa plan buradan başlar)
  dueDate?: string          // Hatırlatma (gecikme rozeti) — ödeme planını kaydırmaz
  monthlyPayment?: number
  totalInstallments?: number
  paidInstallments?: number
  counterparty?: string     // "Garanti BBVA", "Ahmet Yılmaz"
  accountId?: string        // Account payments are drawn from
  notes?: string
  isSettled: boolean
  createdAt: string
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
}

export interface DebtWithRemaining extends Debt {
  remainingAmount: number
  progressPercent: number
}

// ─── UI Store ──────────────────────────────────────────────────────────────

export type ModalType =
  | 'add-transaction'
  | 'edit-transaction'
  | 'add-recurring'
  | 'edit-recurring'
  | 'refund-transaction'
  | 'reconcile-balance'
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
  /** Set when editing a projected (not yet generated) recurring occurrence —
   *  the synthetic Transaction from projectPlannedTransactions(). Its `id` is
   *  the deterministic recur:<templateId>:<date> id, so saving materializes
   *  THIS occurrence only (template + other occurrences are untouched). */
  plannedTx?: Transaction
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

export type StaticInvestmentAsset =
  | 'GOLD_GRAM'
  | 'GOLD_QUARTER'
  | 'GOLD_HALF'
  | 'GOLD_FULL'
  | 'GOLD_OZ'
  | 'GOLD_BRACELET' // 22 ayar bilezik — gram bazlı, fiyatı has altından değil 22 ayar bilezik kotasyonundan gelir
  | 'USD'
  | 'EUR'
  | 'GBP'

// TEFAS yatırım fonu — asset alanında 'TEFAS:AFA' gibi kod gömülü saklanır,
// böylece holdings hesabı fon bazında ayrışır ve DB şeması değişmez.
export type TefasAsset = `TEFAS:${string}`

export type InvestmentAsset = StaticInvestmentAsset | TefasAsset

export interface InvestmentTransaction {
  id: string
  type: 'buy' | 'sell'
  asset: InvestmentAsset
  quantity: number        // amount of asset units
  pricePerUnit: number    // TRY per unit at transaction time
  sourceAccountId?: string  // buy: account to debit from (optional)
  targetAccountId?: string  // sell: account to credit to (optional)
  linkedTransactionId?: string // id of the linked transaction in transactions table
  pnlLinkedTransactionId?: string // sell: id of the linked "Satış Kârı/Zararı" P&L transaction
  date: string            // ISO 8601 date
  note?: string
  createdAt: string
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
}

export interface PriceData {
  usdTry: number       // 1 USD = X TRY
  eurTry: number       // 1 EUR = X TRY
  gbpTry: number       // 1 GBP = X TRY
  // Altın fiyatları Türkiye kuyum piyasası ALIŞ kotasyonlarıdır (Kapalıçarşı);
  // kaynak erişilemezse uluslararası spottan / gram altından türetilir
  goldGramTry: number     // 1 gram altın = X TRY
  goldQuarterTry?: number // çeyrek altın (TRY/adet)
  goldHalfTry?: number    // yarım altın (TRY/adet)
  goldFullTry?: number    // tam altın (TRY/adet)
  bilezikGramTry?: number // 1 gram 22 ayar bilezik = X TRY
  // Previous day close — optional (absent if yesterday fetch failed)
  prevUsdTry?: number
  prevEurTry?: number
  prevGbpTry?: number
  prevGoldGramTry?: number
  prevGoldQuarterTry?: number
  prevGoldHalfTry?: number
  prevGoldFullTry?: number
  prevBilezikGramTry?: number
  updatedAt: number    // Date.now()
}

// Günlük TEFAS fon fiyatı — /api/prices/tefas yanıtı, store'da kod bazında tutulur
export interface TefasFundPrice {
  code: string        // fon kodu, örn. 'AFA'
  name: string        // fon unvanı
  price: number       // birim pay değeri (TRY)
  prevPrice?: number  // bir önceki işlem günü kapanışı
  date: string        // fiyatın ait olduğu gün (ISO)
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
  deleted_at?: string | null // Tombstone (C3)
  workspaceId?: string      // Çalışma alanı bölümlemesi; yoksa varsayılan alana ait sayılır
}

// ─── Sync outbox (C1 — durable offline writes) ──────────────────────────────

/** A pending mutation awaiting push to Supabase. One entry per (table, entity):
 *  the id is `${table}:${entityId}`, so re-mutating a row COALESCES onto the
 *  same entry holding the latest full snapshot. The snapshot is the DB-ready
 *  row (computed fields + user_id stripped); the flusher upserts it and adds the
 *  current user_id. Entries are removed only on a successful server ACK. */
export interface OutboxEntry {
  id: string                          // `${table}:${entityId}`
  table: string                       // Supabase table name
  entityId: string                    // the row's id
  snapshot: Record<string, unknown>   // DB-ready row to upsert (no user_id)
  attempts: number                    // failed push count (for backoff)
  lastError?: string | null
  enqueuedAt: string                  // first-enqueue time — stable FK ordering
  updatedAt: string
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
  { name: 'Eğlence',           icon: 'movie',            color: '#A855F7', scope: 'expense', isSystem: true, sortOrder: 25 },
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
