import type { Account, Transaction, Budget, BudgetWithSpent, Category, Debt, DebtWithRemaining, MonthYear, PriceData } from '@/types'
import { isInRange, monthRange, yearRange, today } from './date'
import { isReconciliation } from './reconciliation'
import { toMinor, toMajor, sumBy, subMoney } from './money'
import { baseAmount, fromBaseTry } from './fx'

// A transaction is "posted" once its date has arrived AND it is not waiting for
// user approval. approvalStatus null/undefined = legacy row: auto-posts on its
// day (the daily recompute in DataProvider folds it in). 'pending' = approval
// gate: even a due/past date must NOT affect any balance until the user
// approves it in the notification center. 'approved' = normal post rule.
// This is the SINGLE source of truth for "does this row count toward balances".
export function isPosted(
  t: Pick<Transaction, 'date' | 'approvalStatus'>,
  asOf: string = today(),
): boolean {
  return t.date.slice(0, 10) <= asOf && t.approvalStatus !== 'pending'
}

export function excludeFuture<T extends Pick<Transaction, 'date' | 'approvalStatus'>>(
  transactions: T[],
  asOf: string = today(),
): T[] {
  return transactions.filter(t => isPosted(t, asOf))
}

// Sum of all transaction effects on an account, in the ACCOUNT'S OWN currency
// (a TRY account's balance is TRY, a USD account's is USD). Used to derive the
// current balance from initialBalance.
//
// Cross-currency transfers (S2): the outgoing leg is `amount` (already in the
// source = transfer currency). The incoming leg is `amount` when the transfer
// currency matches the target account (same-currency, exact, the common case),
// otherwise the TRY-normalized value converted into the target's currency.
export function computeTransactionEffect(
  account: Pick<Account, 'id' | 'currency'>,
  transactions: Transaction[],
): number {
  let minor = 0
  for (const t of transactions) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) minor -= toMinor(t.amount)
      if (t.toAccountId === account.id) {
        const incoming = t.currency === account.currency
          ? t.amount
          : fromBaseTry(baseAmount(t), account.currency)
        minor += toMinor(incoming)
      }
    } else if (t.accountId === account.id) {
      minor += t.type === 'income' ? toMinor(t.amount) : -toMinor(t.amount)
    }
  }
  return toMajor(minor)
}

export function calcNetWorth(accounts: Account[], prices?: PriceData | null): number {
  let minor = 0
  for (const a of accounts) {
    if (a.isArchived) continue
    let balance = a.balance
    if (prices && a.currency !== 'TRY') {
      if (a.currency === 'USD') balance *= prices.usdTry
      else if (a.currency === 'EUR') balance *= prices.eurTry
      else if (a.currency === 'GBP') balance *= prices.gbpTry
    }
    minor += toMinor(balance)
  }
  return toMajor(minor)
}

// Gross assets: only positive balances count — debts (credit cards, loans
// with negative balance) are excluded, unlike calcNetWorth.
export function calcTotalAssets(accounts: Account[], prices?: PriceData | null): number {
  let minor = 0
  for (const a of accounts) {
    if (a.isArchived) continue
    let balance = a.balance
    if (prices && a.currency !== 'TRY') {
      if (a.currency === 'USD') balance *= prices.usdTry
      else if (a.currency === 'EUR') balance *= prices.eurTry
      else if (a.currency === 'GBP') balance *= prices.gbpTry
    }
    if (balance > 0) minor += toMinor(balance)
  }
  return toMajor(minor)
}

export function calcAvailableCredit(account: Account, transactions: Transaction[] = []): number {
  if (account.type !== 'credit_card' || !account.creditLimit) return 0
  // Balance is negative for credit card debt; posted transactions (past/current
  // installments included) are already folded into it.
  //
  // Taksitli işlemler, taksit sayısından bağımsız olarak satın alma tarihinde
  // TÜM tutarıyla limitten düşer (gerçek kredi kartı davranışı). Bakiye yalnızca
  // tarihi gelmiş taksit satırlarını içerdiğinden, henüz bakiyeye işlenmemiş
  // (gelecek tarihli VEYA onay bekleyen) taksit satırlarının tutarını available
  // limitten ayrıca düşeriz. Böylece satın almanın toplam taahhüdü ilk günden
  // itibaren bloke olur; taksitler geldikçe bakiyeye kayar ama toplam bloke tutar
  // değişmez (net etki sıfır). Borç ödendikçe limit normal şekilde geri açılır.
  let blockedMinor = 0
  for (const t of transactions) {
    if (
      t.isInstallment &&
      t.type === 'expense' &&
      t.accountId === account.id &&
      !isPosted(t)
    ) {
      blockedMinor += toMinor(t.amount)
    }
  }
  return account.creditLimit + account.balance - toMajor(blockedMinor)
}

// categoryId can hold a plain UUID or a JSON-encoded string[] for multi-category budgets
export function getBudgetCategoryIds(budget: Budget): string[] {
  const raw = budget.categoryId
  if (raw && raw.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) return parsed
    } catch {}
  }
  return raw ? [raw] : []
}

// Resolve a budget's display state against the live categories. When the live
// category (or categories, for multi-category budgets) still exist, show their
// names + icons. When they've been deleted, fall back to the name snapshot
// stamped on the budget ("<name> (arşiv)"); if no snapshot exists, a generic
// placeholder. Deleted categories aren't pulled to other devices, so the
// snapshot on the budget itself is the only robust source.
export function resolveBudgetCategories(
  budget: Budget,
  liveCategories: Category[],
): { cats: Category[]; label: string; archived: boolean } {
  const ids = getBudgetCategoryIds(budget)
  const cats = ids
    .map(id => liveCategories.find(c => c.id === id))
    .filter((c): c is Category => Boolean(c))
  if (cats.length > 0) {
    return { cats, label: cats.map(c => c.name).join(', '), archived: false }
  }
  if (budget.categoryName) {
    return { cats: [], label: `${budget.categoryName} (arşiv)`, archived: true }
  }
  return { cats: [], label: 'Bütçe (kategorisi silinmiş)', archived: true }
}

// Kategoriler 3 seviyeye kadar hiyerarşik: bütçe üst kategoriye açılmış olsa da
// harcamalar alt kategorilere kaydedilir. Verilen id'leri tüm alt kategorileriyle
// (transitif) genişletir — kategori detay sayfasındaki descendantIds kuralıyla aynı.
export function expandCategoryIds(ids: string[], categories: Category[]): Set<string> {
  const byParent = new Map<string, string[]>()
  for (const c of categories) {
    if (!c.parentId) continue
    const siblings = byParent.get(c.parentId)
    if (siblings) siblings.push(c.id)
    else byParent.set(c.parentId, [c.id])
  }
  const result = new Set<string>()
  const stack = [...ids]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    const children = byParent.get(id)
    if (children) stack.push(...children)
  }
  return result
}

export function calcBudgetSpent(
  budget: Budget,
  transactions: Transaction[],
  my?: MonthYear,
  categories: Category[] = [],
): number {
  const range = my
    ? monthRange(my)
    : budget.period === 'monthly' && budget.month && budget.year
      ? monthRange({ month: budget.month, year: budget.year })
      : yearRange(budget.year ?? new Date().getFullYear())

  const categoryIds = expandCategoryIds(getBudgetCategoryIds(budget), categories)
  // Budgets are TRY-denominated → sum the normalized amountTry (S3), not raw.
  const matching = transactions.filter(tx =>
    tx.type === 'expense' &&
    tx.categoryId !== undefined &&
    categoryIds.has(tx.categoryId) &&
    isInRange(tx.date, range.from, range.to),
  )
  return sumBy(matching, baseAmount)
}

export function enrichBudget(
  budget: Budget,
  transactions: Transaction[],
  my?: MonthYear,
  categories: Category[] = [],
): BudgetWithSpent {
  const spent = calcBudgetSpent(budget, transactions, my, categories)
  const remaining = Math.max(0, subMoney(budget.amount, spent))
  const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
  const status =
    percentUsed >= 100 ? 'exceeded'
    : percentUsed >= budget.alertThreshold ? 'warning'
    : 'ok'

  return { ...budget, spent, remaining, percentUsed, status }
}

// Yatırım anapara (özsermaye) hareketi — fon/varlık ALIMI ("… Alımı") ve
// satıştaki anapara dönüşü ("… Satışı"). Bunlar gerçek gelir/gider DEĞİL: kendi
// paranın nakit↔varlık arasında yer değiştirmesidir. Akış (gelir/gider/net)
// toplamlarından dışlanır; yalnızca gerçekleşen kâr/zarar ("… Satış Kârı" /
// "… Satış Zararı") gelir/gider sayılır — kullanıcının satıştan gerçek kazancı/
// kaybı budur.
//
// DİKKAT: net-varlık HAM yürüyüşü (calcNetRaw / buildTrendData / NetWorthChart)
// bu satırları YİNE toplamak ZORUNDA — hesap bakiyelerini gerçekten oynatırlar
// (alış nakiti düşürür, satış nakiti artırır) ve portföy değeriyle çift-taraflı
// olarak netleşip net değeri sabit tutarlar. Bu yüzden dışlama yalnızca akış
// fonksiyonlarında (calcPeriodFlow/calcMonthlyFlow) yapılır, sumFlow'un kendisinde
// değil — calcNetRaw da sumFlow'u paylaşır.
export function isInvestmentPrincipalTx(t: Pick<Transaction, 'icon' | 'description'>): boolean {
  return !!t.icon && (t.description.endsWith('Alımı') || t.description.endsWith('Satışı'))
}

// Income/expense/net over an already date-scoped slice, summed in TRY-normalized
// amountTry (S2/S3) via integer minor units (S8). No ghosting — callers decide
// whether to pre-filter reconciliation.
function sumFlow(inRange: Transaction[]): { income: number; expense: number; net: number } {
  const income  = sumBy(inRange.filter(t => t.type === 'income'),  baseAmount)
  const expense = sumBy(inRange.filter(t => t.type === 'expense'), baseAmount)
  return { income, expense, net: subMoney(income, expense) }
}

// Flow metrics (income/expense/net) exclude balance-reconciliation ("ghost")
// entries everywhere — they correct raw balances only and must never inflate
// any income/expense total or average. Net-worth math uses calcMonthlyNetRaw.
export function calcPeriodFlow(
  transactions: Transaction[],
  from: string,
  to: string,
): { income: number; expense: number; net: number } {
  // isPosted: onay bekleyen (pending) ve tarihi gelmemiş satırlar hiçbir akış
  // toplamına girmez — bakiyelerle aynı kural (tek doğruluk kaynağı).
  // slice(0,10): legacy tam-ISO datetime tarih de gün sınırında doğru kıyaslanır.
  const inRange = transactions.filter(tx => {
    const d = tx.date.slice(0, 10)
    return d >= from && d <= to && isPosted(tx) && !isReconciliation(tx) && !isInvestmentPrincipalTx(tx)
  })
  return sumFlow(inRange)
}

export function calcMonthlyFlow(
  transactions: Transaction[],
  my: MonthYear,
): { income: number; expense: number; net: number } {
  const { from, to } = monthRange(my)
  // isPosted: calcPeriodFlow ile aynı kural — pending/gelecek satırlar akışa girmez
  const inRange = transactions.filter(tx => isInRange(tx.date, from, to) && isPosted(tx) && !isReconciliation(tx) && !isInvestmentPrincipalTx(tx))
  return sumFlow(inRange)
}

// Ham net (mutabakat DAHİL) — tarih kapsamı çağıran tarafından belirlenmiş bir
// dilim için. Net varlık geri yürüyüşü gün gün yapılırken kullanılır; mutabakat
// kayıtları ham bakiyeyi gerçekten oynattığı için burada sayılmak zorundadır.
export function calcNetRaw(transactions: Transaction[]): number {
  return sumFlow(transactions).net
}

// Bir (çağıran tarafından zaten kapsamlanmış: tarih/hesap/etiket/kişi) dilimi
// türe göre toplar; para birimi TRY-normalize (baseAmount, S2/S3), kuruş-exact
// (S8). Mutabakat AYIKLANMAZ — çağıran gösterdiği listeye ne dahilse onu geçirir
// (işlem listesi özet çubuğu gibi). Akış metriklerinde mutabakatı dışlaması
// gereken çağıranlar calcPeriodFlow/calcMonthlyFlow kullanmalı. Ham `amount`
// toplayıp ₺+$ karıştıran her yüzeyin (etiket/kişi/bütçe/kategori/işlem özeti)
// tek doğruluk kaynağı.
export function sumByType(
  transactions: Transaction[],
): { income: number; expense: number; transfer: number } {
  return {
    income:   sumBy(transactions.filter(t => t.type === 'income'),   baseAmount),
    expense:  sumBy(transactions.filter(t => t.type === 'expense'),  baseAmount),
    transfer: sumBy(transactions.filter(t => t.type === 'transfer'), baseAmount),
  }
}

// Giderleri bir anahtar (kategori/etiket vb.) altında TRY-normalize (baseAmount)
// ve kuruş-exact (minor birim biriktirme, S8) gruplar. Yatırıma bağlı gider
// satırları (`icon` işaretli) ve mutabakat ghost'ları dışlanır — kategori/etiket
// dağılım grafikleriyle DetailedStats aynı kuralı paylaşsın diye. Dönen değerler
// major-unit float; net'i ≤0 olan anahtarları çağıran ayıklar.
export function sumExpenseByKey(
  transactions: Transaction[],
  keyOf: (t: Transaction) => string,
): Map<string, number> {
  const minor = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'expense' || t.icon) continue
    if (isReconciliation(t)) continue
    const k = keyOf(t)
    minor.set(k, (minor.get(k) ?? 0) + toMinor(baseAmount(t)))
  }
  const out = new Map<string, number>()
  for (const [k, m] of minor) out.set(k, toMajor(m))
  return out
}

export function enrichDebt(debt: Debt): DebtWithRemaining {
  const remainingAmount = Math.max(0, subMoney(debt.totalAmount, debt.paidAmount))
  const progressPercent = debt.totalAmount > 0
    ? Math.min(100, (debt.paidAmount / debt.totalAmount) * 100)
    : 0
  return { ...debt, remainingAmount, progressPercent }
}

export function calcCategorySpend(
  transactions: Transaction[],
  categoryId: string,
  from: string,
  to: string,
): number {
  const matching = transactions.filter(tx =>
    tx.type === 'expense' &&
    tx.categoryId === categoryId &&
    isInRange(tx.date, from, to),
  )
  return sumBy(matching, baseAmount)
}

// Group transactions by date for list display
export function groupByDate(
  transactions: Transaction[],
): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    const key = tx.date.slice(0, 10)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(tx)
  }
  return map
}
