import { db } from '@/lib/db'
import type {
  Account, Transaction, Budget, Debt,
  Person, RecurringTransaction, InvestmentTransaction,
} from '@/types'

// ── Stable IDs ─────────────────────────────────────────────────────────────

const ACC_CHK  = 'demo-acc-chk'   // Garanti BBVA Vadesiz
const ACC_SAV  = 'demo-acc-sav'   // Akbank Birikim
const ACC_CC   = 'demo-acc-cc'    // Yapı Kredi Platinum
const ACC_CSH  = 'demo-acc-csh'   // Nakit
const ACC_USD  = 'demo-acc-usd'   // USD Hesabı
const ACC_LOAN = 'demo-acc-loan'  // Araba Kredisi Hesabı

const PRS_SPOUSE = 'demo-person-spouse'
const PRS_CHILD  = 'demo-person-child'
const PRS_AYSE   = 'demo-person-ayse'   // recipient
const PRS_MEHMET = 'demo-person-mehmet' // recipient

// ── Guard ───────────────────────────────────────────────────────────────────

export async function isDemoLoaded(): Promise<boolean> {
  const acc = await db.accounts.get(ACC_CHK)
  return !!acc
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function loadDemoData(): Promise<void> {
  if (await isDemoLoaded()) return

  const cats = await db.categories.toArray()
  const c = Object.fromEntries(cats.map(cat => [cat.name, cat.id])) as Record<string, string>

  const now = new Date().toISOString()

  // ── Accounts ────────────────────────────────────────────────────────────
  const accounts: Account[] = [
    {
      id: ACC_CHK, name: 'Garanti BBVA Vadesiz', type: 'checking', currency: 'TRY',
      balance: 0, initialBalance: 25000, color: '#1A5CA3', icon: '🏦',
      isArchived: false, createdAt: now,
    },
    {
      id: ACC_SAV, name: 'Akbank Birikim', type: 'savings', currency: 'TRY',
      balance: 0, initialBalance: 60000, color: '#059669', icon: '🏦',
      isArchived: false, createdAt: now,
    },
    {
      id: ACC_CC, name: 'Yapı Kredi Platinum', type: 'credit_card', currency: 'TRY',
      balance: 0, initialBalance: 0, color: '#111110', icon: '💳',
      isArchived: false, createdAt: now,
      creditLimit: 60000, statementDay: 28, dueDay: 10, minPayPct: 3,
    },
    {
      id: ACC_CSH, name: 'Nakit', type: 'cash', currency: 'TRY',
      balance: 0, initialBalance: 1200, color: '#C4732A', icon: '💵',
      isArchived: false, createdAt: now,
    },
    {
      id: ACC_USD, name: 'USD Tasarruf', type: 'savings', currency: 'USD',
      balance: 0, initialBalance: 1500, color: '#0ea5e9', icon: '💰',
      isArchived: false, createdAt: now,
    },
    {
      id: ACC_LOAN, name: 'Araba Kredisi', type: 'loan', currency: 'TRY',
      balance: 0, initialBalance: -180000, color: '#ef4444', icon: '🚗',
      isArchived: false, createdAt: now,
    },
  ]

  // ── People ───────────────────────────────────────────────────────────────
  const people: Person[] = [
    { id: PRS_SPOUSE,  name: 'Eş',         role: 'family_member', createdAt: now },
    { id: PRS_CHILD,   name: 'Çocuk',       role: 'family_member', createdAt: now },
    { id: PRS_AYSE,    name: 'Ayşe Kaya',   role: 'recipient',     createdAt: now },
    { id: PRS_MEHMET,  name: 'Mehmet Demir', role: 'recipient',    createdAt: now },
  ]

  // ── Transactions ─────────────────────────────────────────────────────────
  function d(m: number, day: number) {
    return `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  let _seq = 1
  function tx(opts: {
    date: string
    type: 'expense' | 'income' | 'transfer'
    amount: number
    currency?: 'TRY' | 'USD' | 'EUR' | 'GBP'
    accountId: string
    toAccountId?: string
    catName?: string
    description: string
    notes?: string
    tags?: string[]
    merchant?: string
    familyMemberId?: string
    recipientId?: string
    isInstallment?: boolean
    installTotal?: number
    installIndex?: number
    installGroupId?: string
    debtId?: string
  }): Transaction {
    const seq = String(_seq++).padStart(6, '0')
    return {
      id: `demo-tx-${seq}`,
      type: opts.type,
      amount: opts.amount,
      currency: opts.currency ?? 'TRY',
      date: opts.date,
      accountId: opts.accountId,
      toAccountId: opts.toAccountId,
      categoryId: opts.catName ? (c[opts.catName] ?? undefined) : undefined,
      description: opts.description,
      notes: opts.notes,
      tags: opts.tags,
      merchant: opts.merchant,
      familyMemberId: opts.familyMemberId ?? null,
      recipientId: opts.recipientId ?? null,
      isInstallment: opts.isInstallment ?? false,
      installTotal: opts.installTotal,
      installIndex: opts.installIndex,
      installGroupId: opts.installGroupId,
      debtId: opts.debtId,
      createdAt: now,
      updatedAt: now,
    }
  }

  // Installment group IDs
  const INST_PHONE   = 'demo-inst-phone'
  const INST_LAPTOP  = 'demo-inst-laptop'

  const txs: Transaction[] = [

    // ══════════════════ JANUARY ══════════════════
    tx({ date: d(1,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Ocak Kirası', notes: 'Ev kirası — aylık ödeme', tags: ['sabit-gider'], merchant: 'Apartman Yönetimi' }),
    tx({ date: d(1,5),  type: 'expense', amount: 1240, accountId: ACC_CC,  catName: 'Market',        description: 'Migros Alışveriş', merchant: 'Migros', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(1,7),  type: 'expense', amount: 1380, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell', notes: 'Haftalık yakıt' }),
    tx({ date: d(1,8),  type: 'expense', amount: 620,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Nusret Steakhouse', merchant: 'Nusret', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(1,10), type: 'expense', amount: 520,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura','sabit-gider'] }),
    tx({ date: d(1,11), type: 'expense', amount: 380,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Doğalgaz Faturası', tags: ['fatura','sabit-gider'] }),
    tx({ date: d(1,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura','sabit-gider'] }),
    tx({ date: d(1,13), type: 'expense', amount: 970,  accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(1,15), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', merchant: 'Netflix', tags: ['abonelik'] }),
    tx({ date: d(1,17), type: 'expense', amount: 680,  accountId: ACC_CC,  catName: 'Market',        description: 'BİM Alışveriş', merchant: 'BİM' }),
    tx({ date: d(1,18), type: 'expense', amount: 1050, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(1,20), type: 'expense', amount: 480,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Çıtır Ev Yemekleri', merchant: 'Getir' }),
    tx({ date: d(1,22), type: 'expense', amount: 1800, accountId: ACC_CC,  catName: 'Giyim',         description: 'Zara', merchant: 'Zara', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(1,23), type: 'expense', amount: 750,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(1,25), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Ocak Maaşı', notes: 'Ocak 2026 maaş ödemesi' }),
    tx({ date: d(1,25), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(1,26), type: 'expense', amount: 350,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Sinema', merchant: 'Cinemaximum', familyMemberId: PRS_CHILD }),
    tx({ date: d(1,28), type: 'transfer', amount: 5000, accountId: ACC_CHK, toAccountId: ACC_SAV,    description: 'Aylık Birikim' }),
    tx({ date: d(1,30), type: 'expense', amount: 280,  accountId: ACC_CSH, catName: 'Yemek Dışarı',  description: 'Simitçi & Kahve' }),
    // Loan payment
    tx({ date: d(1,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',  description: 'Araba Kredisi Taksiti', tags: ['kredi','sabit-gider'], debtId: 'demo-debt-1' }),

    // ══════════════════ FEBRUARY ══════════════════
    tx({ date: d(2,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Şubat Kirası', tags: ['sabit-gider'], merchant: 'Apartman Yönetimi' }),
    tx({ date: d(2,4),  type: 'expense', amount: 890,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(2,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Araba Kredisi Taksiti', tags: ['kredi'], debtId: 'demo-debt-1' }),
    tx({ date: d(2,6),  type: 'expense', amount: 1350, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell' }),
    tx({ date: d(2,8),  type: 'expense', amount: 420,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Köfteci Yusuf', merchant: 'Köfteci Yusuf' }),
    tx({ date: d(2,10), type: 'expense', amount: 610,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura'] }),
    tx({ date: d(2,11), type: 'expense', amount: 410,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Doğalgaz Faturası', tags: ['fatura'] }),
    tx({ date: d(2,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura'] }),
    tx({ date: d(2,14), type: 'expense', amount: 2400, accountId: ACC_CC,  catName: 'Giyim',         description: 'Mavi & LC Waikiki', merchant: 'Mavi', familyMemberId: PRS_CHILD }),
    tx({ date: d(2,15), type: 'expense', amount: 5000, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Ahmet\'e Ödeme', notes: 'Borç geri ödemesi', recipientId: PRS_MEHMET, debtId: 'demo-debt-2' }),
    tx({ date: d(2,16), type: 'expense', amount: 1050, accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA' }),
    tx({ date: d(2,18), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', tags: ['abonelik'] }),
    tx({ date: d(2,19), type: 'expense', amount: 1100, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(2,21), type: 'expense', amount: 680,  accountId: ACC_CC,  catName: 'Market',        description: 'A101 Market', merchant: 'A101' }),
    tx({ date: d(2,22), type: 'expense', amount: 850,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Burger Lab', merchant: 'Burger Lab', familyMemberId: PRS_CHILD }),
    tx({ date: d(2,25), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Şubat Maaşı' }),
    tx({ date: d(2,25), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(2,26), type: 'expense', amount: 450,  accountId: ACC_CC,  catName: 'Sağlık',        description: 'Eczane', merchant: 'Eczane' }),
    tx({ date: d(2,27), type: 'expense', amount: 780,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(2,28), type: 'transfer', amount: 4000, accountId: ACC_CHK, toAccountId: ACC_SAV,    description: 'Aylık Birikim' }),

    // ══════════════════ MARCH ══════════════════
    tx({ date: d(3,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Mart Kirası', tags: ['sabit-gider'] }),
    tx({ date: d(3,3),  type: 'expense', amount: 920,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(3,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Araba Kredisi Taksiti', tags: ['kredi'], debtId: 'demo-debt-1' }),
    tx({ date: d(3,5),  type: 'expense', amount: 1280, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell' }),
    tx({ date: d(3,7),  type: 'expense', amount: 560,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Şişhane Restaurant', merchant: 'Şişhane' }),
    tx({ date: d(3,10), type: 'expense', amount: 580,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura'] }),
    tx({ date: d(3,11), type: 'expense', amount: 290,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Doğalgaz Faturası', tags: ['fatura'] }),
    tx({ date: d(3,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura'] }),
    tx({ date: d(3,14), type: 'expense', amount: 1100, accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA' }),
    tx({ date: d(3,16), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', tags: ['abonelik'] }),
    // Installment: iPhone 16 - 12 taksit
    tx({ date: d(3,18), type: 'expense', amount: 4500, accountId: ACC_CC,  catName: 'Teknoloji', description: 'iPhone 16 Pro (1/12)', isInstallment: true, installTotal: 12, installIndex: 1, installGroupId: INST_PHONE, merchant: 'Apple' }),
    tx({ date: d(3,19), type: 'expense', amount: 1050, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(3,20), type: 'expense', amount: 720,  accountId: ACC_CC,  catName: 'Market',        description: 'BİM Market', merchant: 'BİM' }),
    tx({ date: d(3,22), type: 'expense', amount: 480,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Burger King', merchant: 'Burger King', familyMemberId: PRS_CHILD }),
    tx({ date: d(3,24), type: 'expense', amount: 1800, accountId: ACC_CC,  catName: 'Giyim',         description: 'H&M', merchant: 'H&M' }),
    tx({ date: d(3,25), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Mart Maaşı' }),
    tx({ date: d(3,25), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(3,25), type: 'income',  amount: 8000,  accountId: ACC_CHK, catName: 'Diğer Gelir',  description: 'Freelance Proje', notes: 'Web projesi', recipientId: PRS_AYSE }),
    tx({ date: d(3,26), type: 'expense', amount: 380,  accountId: ACC_CC,  catName: 'Sağlık',        description: 'Doktor Muayenesi', merchant: 'Özel Muayene', familyMemberId: PRS_CHILD }),
    tx({ date: d(3,28), type: 'transfer', amount: 6000, accountId: ACC_CHK, toAccountId: ACC_SAV,    description: 'Aylık Birikim' }),
    tx({ date: d(3,30), type: 'expense', amount: 650,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),

    // ══════════════════ APRIL ══════════════════
    tx({ date: d(4,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Nisan Kirası', tags: ['sabit-gider'] }),
    tx({ date: d(4,3),  type: 'expense', amount: 1050, accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(4,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Araba Kredisi Taksiti', tags: ['kredi'], debtId: 'demo-debt-1' }),
    tx({ date: d(4,5),  type: 'expense', amount: 1320, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell' }),
    tx({ date: d(4,7),  type: 'expense', amount: 620,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Sunset Grill', merchant: 'Sunset Grill', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(4,10), type: 'expense', amount: 540,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura'] }),
    tx({ date: d(4,11), type: 'expense', amount: 180,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Doğalgaz Faturası', tags: ['fatura'] }),
    tx({ date: d(4,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura'] }),
    // Installment: iPhone 16 - taksit 2
    tx({ date: d(4,18), type: 'expense', amount: 4500, accountId: ACC_CC,  catName: 'Teknoloji', description: 'iPhone 16 Pro (2/12)', isInstallment: true, installTotal: 12, installIndex: 2, installGroupId: INST_PHONE, merchant: 'Apple' }),
    tx({ date: d(4,14), type: 'expense', amount: 820,  accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA' }),
    tx({ date: d(4,15), type: 'income',  amount: 3500, accountId: ACC_CHK, catName: 'Diğer Gelir',   description: 'Freelance Gelir', recipientId: PRS_AYSE }),
    tx({ date: d(4,16), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', tags: ['abonelik'] }),
    tx({ date: d(4,18), type: 'expense', amount: 980,  accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(4,19), type: 'expense', amount: 1450, accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(4,22), type: 'expense', amount: 750,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Mandabatmaz & Karaköy', merchant: 'Mandabatmaz' }),
    tx({ date: d(4,23), type: 'expense', amount: 2800, accountId: ACC_CC,  catName: 'Giyim',         description: 'Vakko', merchant: 'Vakko', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(4,25), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Nisan Maaşı' }),
    tx({ date: d(4,25), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(4,27), type: 'expense', amount: 1200, accountId: ACC_CC,  catName: 'Sağlık',        description: 'Özel Hastane Muayene', merchant: 'Acıbadem', familyMemberId: PRS_CHILD }),
    tx({ date: d(4,28), type: 'transfer', amount: 5000, accountId: ACC_CHK, toAccountId: ACC_SAV,    description: 'Aylık Birikim' }),
    tx({ date: d(4,29), type: 'expense', amount: 580,  accountId: ACC_CC,  catName: 'Market',        description: 'A101 Market', merchant: 'A101' }),

    // ══════════════════ MAY ══════════════════
    tx({ date: d(5,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Mayıs Kirası', tags: ['sabit-gider'] }),
    tx({ date: d(5,2),  type: 'expense', amount: 880,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(5,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Araba Kredisi Taksiti', tags: ['kredi'], debtId: 'demo-debt-1' }),
    tx({ date: d(5,4),  type: 'expense', amount: 1150, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell' }),
    tx({ date: d(5,6),  type: 'expense', amount: 480,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Fasulyeci Ali Baba', merchant: 'Fasulyeci Ali Baba' }),
    tx({ date: d(5,10), type: 'expense', amount: 560,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura'] }),
    tx({ date: d(5,11), type: 'expense', amount: 320,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Su Faturası', tags: ['fatura'] }),
    tx({ date: d(5,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura'] }),
    tx({ date: d(5,13), type: 'expense', amount: 1200, accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(5,15), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', tags: ['abonelik'] }),
    // Installment: laptop 6 taksit
    tx({ date: d(5,16), type: 'expense', amount: 4500, accountId: ACC_CC, catName: 'Teknoloji', description: 'MacBook Air M3 (1/6)', isInstallment: true, installTotal: 6, installIndex: 1, installGroupId: INST_LAPTOP, merchant: 'Apple' }),
    // Installment: iPhone 16 - taksit 3
    tx({ date: d(5,18), type: 'expense', amount: 4500, accountId: ACC_CC,  catName: 'Teknoloji', description: 'iPhone 16 Pro (3/12)', isInstallment: true, installTotal: 12, installIndex: 3, installGroupId: INST_PHONE, merchant: 'Apple' }),
    tx({ date: d(5,18), type: 'expense', amount: 1100, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(5,20), type: 'expense', amount: 680,  accountId: ACC_CC,  catName: 'Market',        description: 'BİM Market', merchant: 'BİM' }),
    tx({ date: d(5,21), type: 'expense', amount: 920,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Zübeyir Ocakbaşı', merchant: 'Zübeyir', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(5,23), type: 'expense', amount: 650,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Konser Bileti', notes: 'Müzik festivali', merchant: 'Biletix', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(5,25), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Mayıs Maaşı' }),
    tx({ date: d(5,25), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(5,26), type: 'expense', amount: 780,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(5,28), type: 'transfer', amount: 5000, accountId: ACC_CHK, toAccountId: ACC_SAV,    description: 'Aylık Birikim' }),
    tx({ date: d(5,28), type: 'income',  amount: 5000,  accountId: ACC_USD, catName: 'Yatırım Geliri', currency: 'USD', description: 'USD Faiz Geliri' }),
    tx({ date: d(5,30), type: 'expense', amount: 420,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Nişantaşı Kahvaltı', merchant: 'Gram Kahve', familyMemberId: PRS_SPOUSE }),

    // ══════════════════ JUNE ══════════════════
    tx({ date: d(6,1),  type: 'expense', amount: 18500, accountId: ACC_CHK, catName: 'Kira & Konut', description: 'Haziran Kirası', tags: ['sabit-gider'] }),
    tx({ date: d(6,3),  type: 'expense', amount: 1050, accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(6,5),  type: 'expense', amount: 4500, accountId: ACC_CHK, catName: 'Diğer Gider',   description: 'Araba Kredisi Taksiti', tags: ['kredi'], debtId: 'demo-debt-1' }),
    tx({ date: d(6,5),  type: 'expense', amount: 1380, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'Shell' }),
    tx({ date: d(6,7),  type: 'expense', amount: 540,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Vogue Restaurant', merchant: 'Vogue', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(6,10), type: 'expense', amount: 620,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Elektrik Faturası', tags: ['fatura'] }),
    tx({ date: d(6,11), type: 'expense', amount: 220,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'Su Faturası', tags: ['fatura'] }),
    tx({ date: d(6,12), type: 'expense', amount: 350,  accountId: ACC_CHK, catName: 'Faturalar',     description: 'İnternet Faturası', tags: ['fatura'] }),
    tx({ date: d(6,14), type: 'expense', amount: 960,  accountId: ACC_CC,  catName: 'Market',        description: 'Carrefour Market', merchant: 'CarrefourSA' }),
    tx({ date: d(6,15), type: 'expense', amount: 320,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Netflix & Spotify', tags: ['abonelik'] }),
    // Installment: iPhone taksit 4
    tx({ date: d(6,18), type: 'expense', amount: 4500, accountId: ACC_CC,  catName: 'Teknoloji', description: 'iPhone 16 Pro (4/12)', isInstallment: true, installTotal: 12, installIndex: 4, installGroupId: INST_PHONE, merchant: 'Apple' }),
    // Installment: laptop taksit 2
    tx({ date: d(6,16), type: 'expense', amount: 4500, accountId: ACC_CC,  catName: 'Teknoloji', description: 'MacBook Air M3 (2/6)', isInstallment: true, installTotal: 6, installIndex: 2, installGroupId: INST_LAPTOP, merchant: 'Apple' }),
    tx({ date: d(6,17), type: 'expense', amount: 1250, accountId: ACC_CC,  catName: 'Ulaşım',        description: 'Akaryakıt', merchant: 'BP' }),
    tx({ date: d(6,18), type: 'expense', amount: 820,  accountId: ACC_CC,  catName: 'Market',        description: 'Migros Market', merchant: 'Migros' }),
    tx({ date: d(6,20), type: 'expense', amount: 680,  accountId: ACC_CC,  catName: 'Yemek Dışarı',  description: 'Brasserie Lola', merchant: 'Brasserie Lola' }),
    tx({ date: d(6,21), type: 'expense', amount: 450,  accountId: ACC_CSH, catName: 'Yemek Dışarı',  description: 'Simit Sarayı', merchant: 'Simit Sarayı' }),
    tx({ date: d(6,22), type: 'expense', amount: 280,  accountId: ACC_CC,  catName: 'Eğlence',       description: 'Kitap & Dergi', merchant: 'D&R', familyMemberId: PRS_CHILD }),
    tx({ date: d(6,23), type: 'income',  amount: 42000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Haziran Maaşı' }),
    tx({ date: d(6,23), type: 'income',  amount: 15000, accountId: ACC_CHK, catName: 'Maaş',         description: 'Eş Maaşı', familyMemberId: PRS_SPOUSE }),
    tx({ date: d(6,23), type: 'income',  amount: 12000, accountId: ACC_CHK, catName: 'Kira Geliri',  description: 'Kiracı Ödemesi', notes: 'Şişli dairesi kira geliri', recipientId: PRS_AYSE }),
  ]

  txs.sort((a, b) => b.date.localeCompare(a.date))

  // ── Budgets (Haziran 2026) ───────────────────────────────────────────────
  const budgets: Budget[] = [
    { id: 'demo-bgt-1', categoryId: c['Market']       ?? '', amount: 5000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-2', categoryId: c['Kira & Konut'] ?? '', amount: 19000, period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 90 },
    { id: 'demo-bgt-3', categoryId: c['Ulaşım']       ?? '', amount: 3000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-4', categoryId: c['Faturalar']    ?? '', amount: 2000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 85 },
    { id: 'demo-bgt-5', categoryId: c['Yemek Dışarı'] ?? '', amount: 2500,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-6', categoryId: c['Eğlence']      ?? '', amount: 1200,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 75 },
    { id: 'demo-bgt-7', categoryId: c['Teknoloji']    ?? '', amount: 5000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
    { id: 'demo-bgt-8', categoryId: c['Sağlık']       ?? '', amount: 2000,  period: 'monthly', year: 2026, month: 6, rollover: false, alertThreshold: 80 },
  ].filter(b => b.categoryId) as Budget[]

  // ── Debts ────────────────────────────────────────────────────────────────
  const debts: Debt[] = [
    {
      id: 'demo-debt-1',
      name: 'Araba Kredisi',
      type: 'bank_loan',
      direction: 'owe',
      totalAmount: 180000,
      paidAmount: 27000,   // 6 months × 4500
      interestRate: 4.5,
      startDate: '2025-12-01',
      dueDate: '2026-07-05',
      monthlyPayment: 4500,
      totalInstallments: 48,
      paidInstallments: 6,
      counterparty: 'Garanti BBVA',
      accountId: ACC_CHK,
      notes: 'Sıfır araç kredisi — 4 yıl vadeli',
      isSettled: false,
      createdAt: now,
    },
    {
      id: 'demo-debt-2',
      name: 'Mehmet\'e Borç',
      type: 'personal',
      direction: 'owe',
      totalAmount: 10000,
      paidAmount: 5000,
      startDate: '2026-01-15',
      dueDate: '2026-08-15',
      counterparty: 'Mehmet Demir',
      notes: 'Taşınma masrafları için alınan borç',
      isSettled: false,
      createdAt: now,
    },
    {
      id: 'demo-debt-3',
      name: 'Ayşe\'den Alacak',
      type: 'personal',
      direction: 'owed',
      totalAmount: 7500,
      paidAmount: 2500,
      startDate: '2026-03-01',
      dueDate: '2026-09-01',
      counterparty: 'Ayşe Kaya',
      notes: 'Ortak proje masrafları',
      isSettled: false,
      createdAt: now,
    },
    {
      id: 'demo-debt-4',
      name: 'Konut Kredisi',
      type: 'bank_loan',
      direction: 'owe',
      totalAmount: 2400000,
      paidAmount: 360000,
      interestRate: 3.2,
      startDate: '2024-01-01',
      dueDate: '2026-07-01',
      monthlyPayment: 18000,
      totalInstallments: 180,
      paidInstallments: 18,
      counterparty: 'Yapı Kredi',
      accountId: ACC_CHK,
      notes: '20 yıl vadeli konut kredisi',
      isSettled: false,
      createdAt: now,
    },
  ]

  // ── Recurring Transactions ───────────────────────────────────────────────
  const recurring: RecurringTransaction[] = [
    {
      id: 'demo-rec-1',
      name: 'Maaş',
      type: 'income',
      amount: 42000,
      currency: 'TRY',
      accountId: ACC_CHK,
      categoryId: c['Maaş'] ?? undefined,
      description: 'Aylık Maaş',
      frequency: 'monthly',
      dayOfMonth: 25,
      startDate: '2026-01-25',
      nextDueDate: '2026-07-25',
      lastGeneratedDate: '2026-06-23',
      isActive: true,
      createdAt: now,
    },
    {
      id: 'demo-rec-2',
      name: 'Kira',
      type: 'expense',
      amount: 18500,
      currency: 'TRY',
      accountId: ACC_CHK,
      categoryId: c['Kira & Konut'] ?? undefined,
      description: 'Aylık Kira Ödemesi',
      notes: 'Her ayın 1\'inde',
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: '2026-01-01',
      nextDueDate: '2026-07-01',
      lastGeneratedDate: '2026-06-01',
      isActive: true,
      createdAt: now,
    },
    {
      id: 'demo-rec-3',
      name: 'Netflix & Spotify',
      type: 'expense',
      amount: 320,
      currency: 'TRY',
      accountId: ACC_CC,
      categoryId: c['Eğlence'] ?? undefined,
      description: 'Netflix & Spotify Aboneliği',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2026-01-15',
      nextDueDate: '2026-07-15',
      lastGeneratedDate: '2026-06-15',
      isActive: true,
      createdAt: now,
    },
    {
      id: 'demo-rec-4',
      name: 'Araba Kredisi',
      type: 'expense',
      amount: 4500,
      currency: 'TRY',
      accountId: ACC_CHK,
      categoryId: c['Diğer Gider'] ?? undefined,
      description: 'Araba Kredisi Taksiti',
      frequency: 'monthly',
      dayOfMonth: 5,
      startDate: '2026-01-05',
      nextDueDate: '2026-07-05',
      lastGeneratedDate: '2026-06-05',
      isActive: true,
      createdAt: now,
    },
    {
      id: 'demo-rec-5',
      name: 'Eş Maaşı',
      type: 'income',
      amount: 15000,
      currency: 'TRY',
      accountId: ACC_CHK,
      categoryId: c['Maaş'] ?? undefined,
      description: 'Eş Aylık Maaş',
      frequency: 'monthly',
      dayOfMonth: 25,
      startDate: '2026-01-25',
      nextDueDate: '2026-07-25',
      lastGeneratedDate: '2026-06-23',
      isActive: true,
      createdAt: now,
      familyMemberId: PRS_SPOUSE,
    },
    {
      id: 'demo-rec-6',
      name: 'İnternet Faturası',
      type: 'expense',
      amount: 350,
      currency: 'TRY',
      accountId: ACC_CHK,
      categoryId: c['Faturalar'] ?? undefined,
      description: 'Aylık İnternet Faturası',
      frequency: 'monthly',
      dayOfMonth: 12,
      startDate: '2026-01-12',
      nextDueDate: '2026-07-12',
      lastGeneratedDate: '2026-06-12',
      isActive: true,
      createdAt: now,
    },
  ]

  // ── Investment Transactions ──────────────────────────────────────────────
  const investTxs: InvestmentTransaction[] = [
    {
      id: 'demo-inv-1',
      type: 'buy',
      asset: 'GOLD_GRAM',
      quantity: 10,
      pricePerUnit: 3200,
      sourceAccountId: ACC_SAV,
      date: '2026-01-15',
      note: 'Altın alımı — birikim amaçlı',
      createdAt: now,
    },
    {
      id: 'demo-inv-2',
      type: 'buy',
      asset: 'USD',
      quantity: 500,
      pricePerUnit: 34.2,
      sourceAccountId: ACC_CHK,
      date: '2026-02-10',
      note: 'Döviz alımı',
      createdAt: now,
    },
    {
      id: 'demo-inv-3',
      type: 'buy',
      asset: 'GOLD_GRAM',
      quantity: 5,
      pricePerUnit: 3450,
      sourceAccountId: ACC_SAV,
      date: '2026-03-20',
      note: 'Altın alımı',
      createdAt: now,
    },
    {
      id: 'demo-inv-4',
      type: 'buy',
      asset: 'EUR',
      quantity: 200,
      pricePerUnit: 37.5,
      sourceAccountId: ACC_CHK,
      date: '2026-04-05',
      note: 'Yaz tatili için Euro',
      createdAt: now,
    },
    {
      id: 'demo-inv-5',
      type: 'buy',
      asset: 'GOLD_QUARTER',
      quantity: 2,
      pricePerUnit: 5600,
      sourceAccountId: ACC_SAV,
      date: '2026-05-01',
      note: 'Çeyrek altın',
      createdAt: now,
    },
    {
      id: 'demo-inv-6',
      type: 'buy',
      asset: 'USD',
      quantity: 300,
      pricePerUnit: 35.8,
      sourceAccountId: ACC_CHK,
      date: '2026-06-01',
      note: 'Dolar alımı',
      createdAt: now,
    },
    {
      id: 'demo-inv-7',
      type: 'sell',
      asset: 'USD',
      quantity: 100,
      pricePerUnit: 36.5,
      targetAccountId: ACC_CHK,
      date: '2026-06-20',
      note: 'Kısmi satış — nakit ihtiyacı',
      createdAt: now,
    },
  ]

  // ── Write ────────────────────────────────────────────────────────────────
  await db.accounts.bulkAdd(accounts)
  await db.people.bulkAdd(people)
  await db.transactions.bulkAdd(txs)
  await db.budgets.bulkAdd(budgets)
  await db.debts.bulkAdd(debts)
  await db.recurringTransactions.bulkAdd(recurring)
  await db.investmentTransactions.bulkAdd(investTxs)
}

// ── Clear ────────────────────────────────────────────────────────────────────

export async function clearAllData(): Promise<void> {
  await db.transactions.clear()
  await db.accounts.clear()
  await db.budgets.clear()
  await db.debts.clear()
  await db.investmentTransactions.clear()
  await db.people.clear()
  await db.recurringTransactions.clear()
}
