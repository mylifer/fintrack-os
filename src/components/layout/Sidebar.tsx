'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { clearLocalData } from '@/lib/auth'
import { useAccountStore, useInvestmentStore, useRecurringStore, useTransactionStore, useBudgetStore, useCategoryStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, computeTransactionEffect, getBudgetCategoryIds } from '@/lib/utils/calculations'
import { computeHoldings } from '@/store/investment.store'
import { today, currentMonthYear, prevMonth, monthRange } from '@/lib/utils/date'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

/* ── Minimal inline SVG icon (Heroicons outline) ── */
function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="flex-shrink-0"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

const IC = {
  home:        'm2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
  tx:          'M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5',
  categories:  'M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z',
  accounts:    'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
  investments: 'M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
  reports:     'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  budgets:     'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  debts:       'M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings:    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
  chevron:     'm8.25 4.5 7.5 7.5-7.5 7.5',
  family:      'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z',
  recipient:   'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z',
  recurring:   'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99',
}

const MAIN_NAV = [
  { href: '/dashboard',    label: 'Ana Sayfa',  icon: IC.home },
  { href: '/transactions', label: 'İşlemler',   icon: IC.tx },
  { href: '/categories',   label: 'Kategoriler', icon: IC.categories },
]

const LOWER_NAV_TOP = [
  { href: '/investments',  label: 'Yatırımlar', icon: IC.investments },
  { href: '/reports',      label: 'Raporlar',   icon: IC.reports },
]

const LOWER_NAV_BOTTOM = [
  { href: '/debts',        label: 'Borçlar',       icon: IC.debts },
  { href: '/recurring',    label: 'Tekrarlayan',   icon: IC.recurring },
  { href: '/aile-uyeleri', label: 'Aile Üyeleri', icon: IC.family },
  { href: '/alicilar',     label: 'Alıcılar',      icon: IC.recipient },
]

const itemBase = 'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors duration-100'
const itemActive = 'bg-primary/10 text-primary font-medium'
const itemInactive = 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'

function navCls(active: boolean) {
  return `${itemBase} ${active ? itemActive : itemInactive}`
}

export function Sidebar() {
  const pathname       = usePathname()
  const router         = useRouter()

  async function handleSignOut() {
    await clearLocalData()
    await supabase.auth.signOut()
    router.push('/login')
  }
  const accounts       = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const investValue    = useInvestmentStore(s => s.getPortfolioValue())
  const prices         = useInvestmentStore(s => s.prices)
  const investTxs      = useInvestmentStore(s => s.transactions)
  const transactions   = useTransactionStore(useShallow(s => s.transactions))
  const getDue         = useRecurringStore(s => s.getDue)
  const dueCount       = getDue(today()).length

  const totalWealth     = calcNetWorth(accounts, prices) + investValue
  const animTotalWealth = useCountUp(totalWealth)

  const trendAmount = useMemo(() => {
    const cutoff = monthRange(prevMonth(currentMonthYear())).to
    const prevTxs = transactions.filter(t => t.date <= cutoff)
    const prevAccounts = accounts.map(a => ({
      ...a,
      balance: a.initialBalance + computeTransactionEffect(a.id, prevTxs),
    }))
    const prevAccountNetWorth = calcNetWorth(prevAccounts, prices)
    const prevInvestTxs = investTxs.filter(t => t.date <= cutoff)
    const prevInvestValue = computeHoldings(prevInvestTxs, prices).reduce((s, h) => s + h.currentValue, 0)
    return totalWealth - (prevAccountNetWorth + prevInvestValue)
  }, [accounts, transactions, investTxs, prices, totalWealth])

  const budgets      = useBudgetStore(s => s.budgets.filter(b => b.period === 'monthly'))
  const allCategories = useCategoryStore(s => s.categories)

  const activeAccounts = accounts

  const isOnAccounts = pathname === '/accounts' || pathname.startsWith('/accounts/')
  const [accountsOpen, setAccountsOpen] = useState(isOnAccounts)

  useEffect(() => {
    if (isOnAccounts) setAccountsOpen(true)
  }, [isOnAccounts])

  const isOnBudgets = pathname === '/budgets' || pathname.startsWith('/budgets/')
  const [budgetsOpen, setBudgetsOpen] = useState(isOnBudgets)

  useEffect(() => {
    if (isOnBudgets) setBudgetsOpen(true)
  }, [isOnBudgets])

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 shrink-0 bg-background border-r border-border">

      {/* ── Logo ── */}
      <div className="px-5 pt-7 pb-6 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-black text-sm select-none">
            F
          </div>
          <span className="text-[15px] font-bold text-foreground">
            fin<span className="text-primary">track</span>
          </span>
        </div>
      </div>

      {/* ── Main nav ── */}
      <nav className="flex-1 px-3 flex flex-col gap-1 overflow-y-auto min-h-0">

        {MAIN_NAV.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={navCls(pathname === href)}>
            <Icon d={icon} />
            <span>{label}</span>
          </Link>
        ))}

        {/* Accounts — expandable */}
        <button
          type="button"
          onClick={() => setAccountsOpen(o => !o)}
          className={navCls(isOnAccounts)}
        >
          <Icon d={IC.accounts} />
          <span className="flex-1 text-left">Hesaplar</span>
          <svg
            fill="none" stroke="currentColor" strokeWidth={2}
            viewBox="0 0 24 24" width={14} height={14}
            className="opacity-40 transition-transform duration-200"
            style={{ transform: accountsOpen ? 'rotate(90deg)' : 'none' }}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={IC.chevron} />
          </svg>
        </button>

        {accountsOpen && (
          <div className="ml-[42px] flex flex-col gap-0.5 py-0.5">
            <Link
              href="/accounts"
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                pathname === '/accounts'
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              Tüm Hesaplar
            </Link>
            {activeAccounts.map(account => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}`}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  pathname === `/accounts/${account.id}`
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                ].join(' ')}
              >
                <AccountAvatar account={account} size="xs" />
                <span className="truncate">{account.name}</span>
              </Link>
            ))}
          </div>
        )}

        {LOWER_NAV_TOP.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={navCls(pathname === href)}>
            <Icon d={icon} />
            <span>{label}</span>
          </Link>
        ))}

        {/* Bütçeler — expandable */}
        <button
          type="button"
          onClick={() => setBudgetsOpen(o => !o)}
          className={navCls(isOnBudgets)}
        >
          <Icon d={IC.budgets} />
          <span className="flex-1 text-left">Bütçeler</span>
          <svg
            fill="none" stroke="currentColor" strokeWidth={2}
            viewBox="0 0 24 24" width={14} height={14}
            className="opacity-40 transition-transform duration-200"
            style={{ transform: budgetsOpen ? 'rotate(90deg)' : 'none' }}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={IC.chevron} />
          </svg>
        </button>

        {budgetsOpen && (
          <div className="ml-[42px] flex flex-col gap-0.5 py-0.5">
            <Link
              href="/budgets"
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                pathname === '/budgets'
                  ? 'text-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              Tüm Bütçeler
            </Link>
            {budgets.map(budget => {
              const cats = getBudgetCategoryIds(budget)
                .map(id => allCategories.find(c => c.id === id))
                .filter(Boolean)
              const label = cats.map(c => c!.name).join(', ')
              const icons = cats.map(c => c!.icon).join('')
              return (
                <Link
                  key={budget.id}
                  href={`/budgets/${budget.id}`}
                  className={[
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    pathname === `/budgets/${budget.id}`
                      ? 'text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  ].join(' ')}
                >
                  <span className="text-sm leading-none flex-shrink-0">{icons}</span>
                  <span className="truncate">{label}</span>
                </Link>
              )
            })}
          </div>
        )}

        {LOWER_NAV_BOTTOM.map(({ href, label, icon }) => (
          <Link key={href} href={href} className={navCls(pathname === href)}>
            <Icon d={icon} />
            <span className="flex-1">{label}</span>
            {href === '/recurring' && dueCount > 0 && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-500 leading-none flex-shrink-0">
                {dueCount}
              </span>
            )}
          </Link>
        ))}

      </nav>

      {/* ── Net worth widget ── */}
      <div className="mx-3 mb-3 px-4 py-4 rounded-xl bg-muted border border-border flex-shrink-0">
        <div className="text-xs font-medium tracking-wide uppercase text-muted-foreground mb-1">
          Toplam Net Varlık
        </div>
        <div className={`text-2xl font-normal tabular-nums ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCompact(animTotalWealth)}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5">
          {trendAmount !== 0 && (
            <span className={`text-xs font-semibold tabular-nums ${trendAmount >= 0 ? 'text-green-500' : 'text-destructive'}`}>
              {trendAmount >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(trendAmount))}
            </span>
          )}
          <span className="text-xs text-muted-foreground">geçen aya göre</span>
        </div>
      </div>

      {/* ── Settings + theme + logout (bottom) ── */}
      <div className="px-3 pt-4 pb-5 border-t border-border flex-shrink-0 flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Link href="/settings" className={`${navCls(pathname === '/settings')} flex-1`}>
            <Icon d={IC.settings} />
            <span>Ayarlar</span>
          </Link>
          <ThemeToggle />
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors w-full text-left"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={18} height={18} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
          </svg>
          <span>Çıkış Yap</span>
        </button>
      </div>

    </aside>
  )
}
