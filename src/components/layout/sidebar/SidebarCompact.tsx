'use client'

import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { resolveBudgetCategories } from '@/lib/utils/calculations'
import { formatCompact, formatWhole } from '@/lib/utils/currency'
import { Icon, Chevron, IC } from './icons'
import { NAV_GROUPS } from './nav'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: KOMPAKT (varsayılan) ────────────────────────────────────────
   28px satırlar, hap yok, kılcal grup ayraçları. Amaç: hesaplar açıkken bile
   navigasyonun tamamı tek ekranda kalsın. Aktif satır, panelin sol kenarına
   dayalı 2px turkuaz rayla işaretlenir — satırlar tam genişlikte olduğu için
   ray gerçekten kenara oturur. */

const rowBase = 'relative flex items-center gap-2.5 w-full h-7 px-3 text-[12.5px] transition-colors duration-100'
const rowActive =
  "bg-secondary/70 text-foreground font-semibold before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-primary"
const rowInactive = 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/50'

function navCls(active: boolean) {
  return `${rowBase} ${active ? rowActive : rowInactive}`
}

const subBase = 'relative flex items-center gap-2 w-full h-[26px] pl-[34px] pr-3 text-xs transition-colors duration-100'
const subActive =
  "bg-secondary/70 text-foreground font-semibold before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-primary"
const subInactive = 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'

function subCls(active: boolean) {
  return `${subBase} ${active ? subActive : subInactive}`
}

export function SidebarCompact() {
  const {
    pathname, accounts, budgets, allCategories, dueCount,
    totalWealth, animTotalWealth, trendAmount, trendPct,
    isOnAccounts, accountsOpen, setAccountsOpen,
    isOnBudgets, budgetsOpen, setBudgetsOpen,
    handleSignOut,
  } = useSidebarData()

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 shrink-0 bg-background border-r border-border">

      {/* ── Üst şerit: logo + çalışma alanı tek satırda ── */}
      <div className="h-11 flex-shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-black text-[11px] select-none flex-shrink-0">
          F
        </div>
        <div className="flex-1 min-w-0">
          <WorkspaceSwitcher />
        </div>
      </div>

      {/* ── Nav — tam genişlikte satırlar (sol ray kenara dayansın diye px yok) ── */}
      <nav className="flex-1 py-1.5 overflow-y-auto min-h-0">
        {NAV_GROUPS.map(group => (
          <div key={group.title}>
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
                {group.title}
              </span>
              <span className="flex-1 h-px bg-border/70" />
            </div>

            {group.items.map(item => {
              if (item.expand === 'accounts') {
                return (
                  <div key={item.href}>
                    <button type="button" onClick={() => setAccountsOpen(o => !o)} className={navCls(isOnAccounts)}>
                      <Icon d={item.icon} size={15} className={isOnAccounts ? 'text-primary' : ''} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <Chevron open={accountsOpen} size={11} />
                    </button>

                    {accountsOpen && (
                      <>
                        <Link href="/accounts" className={subCls(pathname === '/accounts')}>
                          <span className="truncate">Tüm Hesaplar</span>
                        </Link>
                        {accounts.map(account => (
                          <Link
                            key={account.id}
                            href={`/accounts/${account.id}`}
                            className={subCls(pathname === `/accounts/${account.id}`)}
                          >
                            <AccountAvatar account={account} size="xs" />
                            <span className="flex-1 min-w-0 truncate">{account.name}</span>
                            <span
                              className={[
                                'flex-shrink-0 tabular-nums text-[11px] font-semibold',
                                account.balance < 0
                                  ? 'text-destructive'
                                  : account.balance > 0
                                    ? 'text-green-500'
                                    : 'text-muted-foreground',
                              ].join(' ')}
                            >
                              {formatWhole(account.balance, account.currency)}
                            </span>
                          </Link>
                        ))}
                      </>
                    )}
                  </div>
                )
              }

              if (item.expand === 'budgets') {
                return (
                  <div key={item.href}>
                    <button type="button" onClick={() => setBudgetsOpen(o => !o)} className={navCls(isOnBudgets)}>
                      <Icon d={item.icon} size={15} className={isOnBudgets ? 'text-primary' : ''} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <Chevron open={budgetsOpen} size={11} />
                    </button>

                    {budgetsOpen && (
                      <>
                        <Link href="/budgets" className={subCls(pathname === '/budgets')}>
                          <span className="truncate">Tüm Bütçeler</span>
                        </Link>
                        {budgets.map(budget => {
                          // Kategorileri silinmiş bütçe boş satır gibi görünmesin;
                          // tıklanabilir kalsın ki düzeltilebilsin.
                          const { cats, label } = resolveBudgetCategories(budget, allCategories)
                          return (
                            <Link
                              key={budget.id}
                              href={`/budgets/${budget.id}`}
                              className={subCls(pathname === `/budgets/${budget.id}`)}
                            >
                              {cats.length > 0 && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  {cats.slice(0, 3).map(c => (
                                    <CategoryIcon key={c.id} icon={c.icon} color={c.color} size={13} />
                                  ))}
                                </span>
                              )}
                              <span className="flex-1 min-w-0 truncate">{label}</span>
                            </Link>
                          )
                        })}
                      </>
                    )}
                  </div>
                )
              }

              const active = pathname === item.href
              return (
                <Link key={item.href} href={item.href} className={navCls(active)}>
                  <Icon d={item.icon} size={15} className={active ? 'text-primary' : ''} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge === 'due' && dueCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-500 leading-none flex-shrink-0">
                      {dueCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Net varlık — tek satırlık şerit ── */}
      <div className="flex-shrink-0 border-t border-border px-3 py-2">
        <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Net Varlık
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-base font-semibold tabular-nums ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatCompact(animTotalWealth)}
          </span>
          {trendAmount !== 0 && trendPct !== null && (
            <span
              className={`text-[10.5px] font-bold tabular-nums ${trendAmount >= 0 ? 'text-green-500' : 'text-destructive'}`}
              title="Geçen aya göre"
            >
              {trendAmount >= 0 ? '▲' : '▼'} %{Math.abs(trendPct).toFixed(1).replace('.', ',')}
            </span>
          )}
        </div>
      </div>

      {/* ── Alt şerit: ayarlar · tema · çıkış ── */}
      <div className="h-10 flex-shrink-0 flex items-center gap-1 px-2 border-t border-border">
        <Link
          href="/settings"
          className={[
            'flex items-center gap-2 h-7 px-2 rounded-md text-xs font-medium transition-colors',
            pathname === '/settings'
              ? 'text-foreground font-semibold bg-secondary/70'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
          ].join(' ')}
        >
          <Icon d={IC.settings} size={15} className={pathname === '/settings' ? 'text-primary' : ''} />
          <span>Ayarlar</span>
        </Link>
        <ThemeToggle />
        <span className="flex-1" />
        <button
          onClick={handleSignOut}
          title="Çıkış Yap"
          aria-label="Çıkış Yap"
          className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
        >
          <Icon d={IC.logout} size={15} />
        </button>
      </div>

    </aside>
  )
}
