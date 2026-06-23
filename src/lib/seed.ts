import { db } from '@/lib/db'
import type { Account, Transaction, Budget, Debt } from '@/types'

const ACC_CHK = 'demo-acc-chk'
const ACC_SAV = 'demo-acc-sav'
const ACC_CC  = 'demo-acc-cc'
const ACC_CSH = 'demo-acc-csh'

export async function isDemoLoaded(): Promise<boolean> {
  const acc = await db.accounts.get(ACC_CHK)
  return !!acc
}

export async function loadDemoData(): Promise<void> {
  if (await isDemoLoaded()) return

  const cats = await db.categories.toArray()
  const c = Object.fromEntries(cats.map(cat => [cat.name, cat.id])) as Record<string, string>

  const now = new Date().toISOString()

  // ── Accounts ──────────────────────────────────────────────────────────────
  const accounts: Account[] = [
    {
      id: ACC_CHK, name: 'Garanti BBVA Vadesiz', type: 'checking', currency: 'TRY',
      balance: 42850, initialBalance: 0, color: '#1A5CA3', isArchived: false, createdAt: now,
    },
    {
      id: ACC_SAV, name: 'Akbank Birikim', type: 'savings', currency: 'TRY',
      balance: 85000, initialBalance: 0, color: '#059669', isArchived: false, createdAt: now,
    },
    {
      id: ACC_CC, name: 'Yapı Kredi Platinum', type: 'credit_card', currency: 'TRY',
      balance: -8750, initialBalance: 0, color: '#111110', isArchived: false, createdAt: now,
      creditLimit: 50000, statementDay: 28, dueDay: 10, minPayPct: 3,
    },
    {
      id: ACC_CSH, name: 'Nakit', type: 'cash', currency: 'TRY',
      balance: 650, initialBalance: 0, color: '#C4732A', isArchived: false, createdAt: now,
    },
  ]

  // ── Transactions ──────────────────────────────────────────────────────────
  // Helper: [month, day] → "2026-MM-DD"
  function d(m: number, day: number) {
    return `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function tx(
    date: string,
    type: 'expense' | 'income' | 'transfer',
    amount: number,
    accountId: string,
    catName: string,
    description: string,
    toAccountId?: string,
  ): Transaction {
    return {
      id: crypto.randomUUID(),
      type, amount, currency: 'TRY', date,
      accountId, toAccountId,
      categoryId: c[catName] || undefined,
      description,
      isInstallment: false,
      createdAt: now, updatedAt: now,
    }
  }

  const txs: Transaction[] = [
    // ── JANUARY ──────────────────────────────────────────────────────────────
    tx(d(1,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Ocak Kirası'),
    tx(d(1,  5), 'expense',    820, ACC_CC,  'Market',         'Migros Market'),
    tx(d(1,  7), 'expense',   1200, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(1,  8), 'expense',    450, ACC_CC,  'Yemek Dışarı',   'Nusret Steakhouse'),
    tx(d(1, 10), 'expense',    520, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(1, 11), 'expense',    380, ACC_CHK, 'Faturalar',      'Doğalgaz Faturası'),
    tx(d(1, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(1, 13), 'expense',    970, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(1, 15), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(1, 17), 'expense',    680, ACC_CC,  'Market',         'BİM Alışveriş'),
    tx(d(1, 18), 'expense',    980, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(1, 20), 'expense',    580, ACC_CC,  'Yemek Dışarı',   'Çıtır Ev Yemekleri'),
    tx(d(1, 22), 'expense',   1200, ACC_CC,  'Giyim',          'Zara'),
    tx(d(1, 23), 'expense',    750, ACC_CC,  'Market',         'Migros Market'),
    tx(d(1, 25), 'income',   38000, ACC_CHK, 'Maaş',           'Ocak Maaşı'),
    tx(d(1, 26), 'expense',    350, ACC_CC,  'Eğlence',        'Sinema'),
    tx(d(1, 28), 'transfer',  4000, ACC_CHK, '',               'Birikim Transferi', ACC_SAV),
    tx(d(1, 30), 'expense',    280, ACC_CSH, 'Yemek Dışarı',   'Simitçi & Kahve'),

    // ── FEBRUARY ─────────────────────────────────────────────────────────────
    tx(d(2,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Şubat Kirası'),
    tx(d(2,  4), 'expense',    890, ACC_CC,  'Market',         'Migros Market'),
    tx(d(2,  6), 'expense',   1350, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(2,  8), 'expense',    420, ACC_CC,  'Yemek Dışarı',   'Köfteci Yusuf'),
    tx(d(2, 10), 'expense',    610, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(2, 11), 'expense',    410, ACC_CHK, 'Faturalar',      'Doğalgaz Faturası'),
    tx(d(2, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(2, 14), 'expense',   2400, ACC_CC,  'Giyim',          'Mavi & LC Waikiki'),
    tx(d(2, 16), 'expense',   1050, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(2, 18), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(2, 19), 'expense',   1100, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(2, 21), 'expense',    680, ACC_CC,  'Market',         'A101 Market'),
    tx(d(2, 22), 'expense',    850, ACC_CC,  'Yemek Dışarı',   'Burger Lab'),
    tx(d(2, 25), 'income',   38000, ACC_CHK, 'Maaş',           'Şubat Maaşı'),
    tx(d(2, 26), 'expense',    450, ACC_CC,  'Sağlık',         'Eczane'),
    tx(d(2, 27), 'expense',    780, ACC_CC,  'Market',         'Migros Market'),
    tx(d(2, 28), 'transfer',  3500, ACC_CHK, '',               'Birikim Transferi', ACC_SAV),

    // ── MARCH ────────────────────────────────────────────────────────────────
    tx(d(3,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Mart Kirası'),
    tx(d(3,  3), 'expense',    920, ACC_CC,  'Market',         'Migros Market'),
    tx(d(3,  5), 'expense',   1280, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(3,  7), 'expense',    560, ACC_CC,  'Yemek Dışarı',   'Şişhane Restaurant'),
    tx(d(3, 10), 'expense',    580, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(3, 11), 'expense',    290, ACC_CHK, 'Faturalar',      'Doğalgaz Faturası'),
    tx(d(3, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(3, 14), 'expense',   1100, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(3, 16), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(3, 18), 'expense',   3200, ACC_CC,  'Teknoloji',      'Apple AirPods'),
    tx(d(3, 19), 'expense',   1050, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(3, 20), 'expense',    720, ACC_CC,  'Market',         'BİM Market'),
    tx(d(3, 22), 'expense',    480, ACC_CC,  'Yemek Dışarı',   'Burger King'),
    tx(d(3, 24), 'expense',   1800, ACC_CC,  'Giyim',          'H&M'),
    tx(d(3, 25), 'income',   38000, ACC_CHK, 'Maaş',           'Mart Maaşı'),
    tx(d(3, 26), 'expense',    380, ACC_CC,  'Sağlık',         'Doktor Muayenesi'),
    tx(d(3, 28), 'transfer',  5000, ACC_CHK, '',               'Birikim Transferi', ACC_SAV),
    tx(d(3, 30), 'expense',    650, ACC_CC,  'Market',         'Migros Market'),

    // ── APRIL ────────────────────────────────────────────────────────────────
    tx(d(4,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Nisan Kirası'),
    tx(d(4,  3), 'expense',   1050, ACC_CC,  'Market',         'Migros Market'),
    tx(d(4,  5), 'expense',   1320, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(4,  7), 'expense',    620, ACC_CC,  'Yemek Dışarı',   'Sunset Grill'),
    tx(d(4, 10), 'expense',    540, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(4, 11), 'expense',    180, ACC_CHK, 'Faturalar',      'Doğalgaz Faturası'),
    tx(d(4, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(4, 14), 'expense',    820, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(4, 15), 'income',    2500, ACC_CHK, 'Diğer Gelir',    'Freelance Gelir'),
    tx(d(4, 16), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(4, 18), 'expense',    980, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(4, 19), 'expense',   1450, ACC_CC,  'Market',         'Migros Market'),
    tx(d(4, 22), 'expense',    750, ACC_CC,  'Yemek Dışarı',   'Mandabatmaz & Karaköy'),
    tx(d(4, 23), 'expense',   2800, ACC_CC,  'Giyim',          'Vakko'),
    tx(d(4, 25), 'income',   38000, ACC_CHK, 'Maaş',           'Nisan Maaşı'),
    tx(d(4, 27), 'expense',   1200, ACC_CC,  'Sağlık',         'Özel Hastane Muayene'),
    tx(d(4, 28), 'transfer',  4500, ACC_CHK, '',               'Birikim Transferi', ACC_SAV),
    tx(d(4, 29), 'expense',    580, ACC_CC,  'Market',         'A101 Market'),

    // ── MAY ──────────────────────────────────────────────────────────────────
    tx(d(5,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Mayıs Kirası'),
    tx(d(5,  2), 'expense',    880, ACC_CC,  'Market',         'Migros Market'),
    tx(d(5,  4), 'expense',   1150, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(5,  6), 'expense',    480, ACC_CC,  'Yemek Dışarı',   'Fasulyeci Ali Baba'),
    tx(d(5, 10), 'expense',    560, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(5, 11), 'expense',    320, ACC_CHK, 'Faturalar',      'Su Faturası'),
    tx(d(5, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(5, 13), 'expense',   1200, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(5, 15), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(5, 17), 'expense',   5800, ACC_CC,  'Teknoloji',      'Samsung Galaxy Tab Aksesuar'),
    tx(d(5, 18), 'expense',   1100, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(5, 20), 'expense',    680, ACC_CC,  'Market',         'BİM Market'),
    tx(d(5, 21), 'expense',    920, ACC_CC,  'Yemek Dışarı',   'Zübeyir Ocakbaşı'),
    tx(d(5, 23), 'expense',    650, ACC_CC,  'Eğlence',        'Konser Bileti'),
    tx(d(5, 25), 'income',   38000, ACC_CHK, 'Maaş',           'Mayıs Maaşı'),
    tx(d(5, 26), 'expense',    780, ACC_CC,  'Market',         'Migros Market'),
    tx(d(5, 28), 'transfer',  5000, ACC_CHK, '',               'Birikim Transferi', ACC_SAV),
    tx(d(5, 30), 'expense',    420, ACC_CC,  'Yemek Dışarı',   'Nişantaşı Kahvaltı'),

    // ── JUNE (through 21st) ───────────────────────────────────────────────────
    tx(d(6,  1), 'expense',  18000, ACC_CHK, 'Kira & Konut',   'Haziran Kirası'),
    tx(d(6,  3), 'expense',   1050, ACC_CC,  'Market',         'Migros Market'),
    tx(d(6,  5), 'expense',   1380, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(6,  7), 'expense',    540, ACC_CC,  'Yemek Dışarı',   'Vogue Restaurant'),
    tx(d(6, 10), 'expense',    620, ACC_CHK, 'Faturalar',      'Elektrik Faturası'),
    tx(d(6, 11), 'expense',    220, ACC_CHK, 'Faturalar',      'Su Faturası'),
    tx(d(6, 12), 'expense',    350, ACC_CHK, 'Faturalar',      'İnternet Faturası'),
    tx(d(6, 14), 'expense',    960, ACC_CC,  'Market',         'Carrefour Market'),
    tx(d(6, 15), 'expense',    320, ACC_CC,  'Eğlence',        'Netflix & Spotify'),
    tx(d(6, 17), 'expense',   1250, ACC_CC,  'Ulaşım',         'Akaryakıt'),
    tx(d(6, 18), 'expense',    820, ACC_CC,  'Market',         'Migros Market'),
    tx(d(6, 20), 'expense',    680, ACC_CC,  'Yemek Dışarı',   'Brasserie Lola'),
    tx(d(6, 21), 'expense',    450, ACC_CSH, 'Yemek Dışarı',   'Simit Sarayı'),
  ]

  // Sort newest first (matches store load order)
  txs.sort((a, b) => b.date.localeCompare(a.date))

  // ── Budgets (June 2026) ───────────────────────────────────────────────────
  const budgets: Budget[] = [
    { id: 'demo-bgt-1', categoryId: c['Market'] ?? '',        amount: 5000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-2', categoryId: c['Kira & Konut'] ?? '',  amount: 18500, period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 90 },
    { id: 'demo-bgt-3', categoryId: c['Ulaşım'] ?? '',        amount: 3500,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-4', categoryId: c['Faturalar'] ?? '',     amount: 2000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 85 },
    { id: 'demo-bgt-5', categoryId: c['Yemek Dışarı'] ?? '',  amount: 3000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-6', categoryId: c['Eğlence'] ?? '',       amount: 1500,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 75 },
  ].filter(b => b.categoryId) as Budget[]

  // ── Debts ─────────────────────────────────────────────────────────────────
  const debts: Debt[] = [
    {
      id: 'demo-debt-1',
      name: 'Araba Kredisi',
      type: 'bank_loan',
      direction: 'owe',
      totalAmount: 180000,
      paidAmount: 63000,
      interestRate: 4.5,
      startDate: '2025-03-01',
      dueDate: '2028-03-01',
      monthlyPayment: 4500,
      totalInstallments: 60,
      paidInstallments: 14,
      counterparty: 'Garanti BBVA',
      accountId: ACC_CHK,
      isSettled: false,
      createdAt: now,
    },
    {
      id: 'demo-debt-2',
      name: 'Ahmet\'e Borç',
      type: 'personal',
      direction: 'owe',
      totalAmount: 5000,
      paidAmount: 2000,
      startDate: '2026-02-15',
      dueDate: '2026-07-15',
      counterparty: 'Ahmet Yılmaz',
      isSettled: false,
      createdAt: now,
    },
  ]

  // ── Write ─────────────────────────────────────────────────────────────────
  await db.accounts.bulkAdd(accounts)
  await db.transactions.bulkAdd(txs)
  await db.budgets.bulkAdd(budgets)
  await db.debts.bulkAdd(debts)
}

export async function clearAllData(): Promise<void> {
  await db.transactions.clear()
  await db.accounts.clear()
  await db.budgets.clear()
  await db.debts.clear()
  await db.investmentTransactions.clear()
  await db.people.clear()
  await db.recurringTransactions.clear()
}
