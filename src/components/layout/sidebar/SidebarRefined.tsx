'use client'

import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { resolveBudgetCategories } from '@/lib/utils/calculations'
import { formatCompact, formatCurrency, formatWhole } from '@/lib/utils/currency'
import { Icon, Chevron, IC } from './icons'
import { NAV_GROUPS } from './nav'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: RAFİNE ──────────────────────────────────────────────────────
   Ferah satırlar, dört başlıklı gruplama, yumuşak aksan hapları ve ayrı bir
   net varlık kartı. Aktif haldeki metin `foreground` (aksan mürekkebi değil):
   turkuaz #00D9D9 açık zeminde metin olarak okunmuyor, ikon olarak okunuyor. */

const itemBase = 'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-[10px] text-[13px] transition-colors duration-100'
const itemActive = 'bg-primary/10 text-foreground font-semibold'
const itemInactive = 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/60'

function navCls(active: boolean) {
  return `${itemBase} ${active ? itemActive : itemInactive}`
}

// Alt liste: öğeler ana etiket sütununa hizalı, soldaki kılcal çizgi hiyerarşiyi
// gösterir; aktif öğe o çizgi üzerinde turkuaz bir segmentle işaretlenir.
const subWrap =
  "relative flex flex-col gap-0.5 py-1 before:content-[''] before:absolute before:left-[19px] before:top-1 before:bottom-1 before:w-px before:bg-border"

function subItemCls(active: boolean, withIcon = false) {
  return [
    'relative rounded-lg text-xs font-medium transition-colors py-1.5 pr-2.5 pl-[40px]',
    withIcon ? 'flex items-center gap-2' : '',
    active
      ? "text-foreground font-semibold before:content-[''] before:absolute before:left-[18px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
  ].join(' ')
}

export function SidebarRefined() {
  const {
    pathname, accounts, budgets, allCategories, dueCount,
    totalWealth, animTotalWealth, trendAmount,
    isOnAccounts, accountsOpen, setAccountsOpen,
    isOnBudgets, budgetsOpen, setBudgetsOpen,
    handleSignOut,
  } = useSidebarData()

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 shrink-0 bg-background border-r border-border">

      {/* ── Logo ── */}
      <div className="px-5 pt-7 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-black text-sm select-none">
            F
          </div>
          <span className="text-[15px] font-bold text-foreground">
            fin<span className="text-primary">track</span>
          </span>
        </div>
      </div>

      {/* ── Çalışma alanı geçişi ── */}
      <div className="px-3 pb-2 flex-shrink-0">
        <WorkspaceSwitcher />
      </div>

      {/* ── Gruplanmış nav ── */}
      <nav className="flex-1 px-3 pb-3 flex flex-col overflow-y-auto min-h-0">
        {NAV_GROUPS.map(group => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 pt-3.5 pb-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              {group.title}
            </div>

            {group.items.map(item => {
              if (item.expand === 'accounts') {
                return (
                  <div key={item.href} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setAccountsOpen(o => !o)}
                      className={navCls(isOnAccounts)}
                    >
                      <Icon d={item.icon} size={17} className={isOnAccounts ? 'text-primary' : ''} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <Chevron open={accountsOpen} />
                    </button>

                    {accountsOpen && (
                      <div className={subWrap}>
                        <Link href="/accounts" className={subItemCls(pathname === '/accounts')}>
                          Tüm Hesaplar
                        </Link>
                        {accounts.map(account => (
                          <Link
                            key={account.id}
                            href={`/accounts/${account.id}`}
                            className={subItemCls(pathname === `/accounts/${account.id}`, true)}
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
                      </div>
                    )}
                  </div>
                )
              }

              if (item.expand === 'budgets') {
                return (
                  <div key={item.href} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setBudgetsOpen(o => !o)}
                      className={navCls(isOnBudgets)}
                    >
                      <Icon d={item.icon} size={17} className={isOnBudgets ? 'text-primary' : ''} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <Chevron open={budgetsOpen} />
                    </button>

                    {budgetsOpen && (
                      <div className={subWrap}>
                        <Link href="/budgets" className={subItemCls(pathname === '/budgets')}>
                          Tüm Bütçeler
                        </Link>
                        {budgets.map(budget => {
                          // Kategorileri silinmiş (çözümlenemeyen) bütçe görünmez bir boş
                          // satır olmasın — yine tıklanabilir kalsın ki düzeltilebilsin.
                          const { cats, label } = resolveBudgetCategories(budget, allCategories)
                          return (
                            <Link
                              key={budget.id}
                              href={`/budgets/${budget.id}`}
                              className={subItemCls(pathname === `/budgets/${budget.id}`, true)}
                            >
                              {cats.length > 0 && (
                                <span className="flex items-center gap-0.5 flex-shrink-0">
                                  {cats.slice(0, 3).map(c => (
                                    <CategoryIcon key={c.id} icon={c.icon} color={c.color} size={14} />
                                  ))}
                                </span>
                              )}
                              <span className="truncate">{label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }

              const active = pathname === item.href
              return (
                <Link key={item.href} href={item.href} className={navCls(active)}>
                  <Icon d={item.icon} size={17} className={active ? 'text-primary' : ''} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge === 'due' && dueCount > 0 && (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-500 leading-none flex-shrink-0">
                      {dueCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Net varlık kartı ── */}
      <div className="mx-3 mb-3 px-3.5 py-3.5 rounded-xl bg-muted border border-border flex-shrink-0">
        <div className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">
          Toplam Net Varlık
        </div>
        <div className={`text-[23px] font-normal tabular-nums mt-0.5 ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
          {formatCompact(animTotalWealth)}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {trendAmount !== 0 && (
            <span className={`text-xs font-semibold tabular-nums ${trendAmount >= 0 ? 'text-green-500' : 'text-destructive'}`}>
              {trendAmount >= 0 ? '▲' : '▼'} {formatCurrency(Math.abs(trendAmount))}
            </span>
          )}
          <span className="text-xs text-muted-foreground">geçen aya göre</span>
        </div>
      </div>

      {/* ── Ayarlar + tema + çıkış ── */}
      <div className="px-3 pt-3 pb-5 border-t border-border flex-shrink-0 flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Link href="/settings" className={`${navCls(pathname === '/settings')} flex-1`}>
            <Icon d={IC.settings} size={17} className={pathname === '/settings' ? 'text-primary' : ''} />
            <span>Ayarlar</span>
          </Link>
          <ThemeToggle />
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors w-full text-left"
        >
          <Icon d={IC.logout} size={17} />
          <span>Çıkış Yap</span>
        </button>
      </div>

    </aside>
  )
}
