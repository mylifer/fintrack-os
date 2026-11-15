'use client'

import Link from 'next/link'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { resolveBudgetCategories } from '@/lib/utils/calculations'
import { formatWhole } from '@/lib/utils/currency'
import { Icon, Chevron } from './icons'
import type { NavItem } from './nav'
import { navBadge } from './useNavBadges'
import type { useSidebarData } from './useSidebarData'

/* ── Ortak öğe listesi ────────────────────────────────────────────────────
   Yüzen Kart, Koyu Kontrast, Çift Panel ve İkon Rayı'nın (açık hâli) satır
   mantığı aynı: açılır hesap/bütçe listeleri, girintili alt sayfalar,
   rozetler. Varyantlar yalnızca sınıfları verir; davranış tek yerde. */

export type SidebarData = ReturnType<typeof useSidebarData>

export interface NavTreeStyles {
  row: (active: boolean) => string
  sub: (active: boolean) => string
  /** Alt listeyi saran kap (kılcal çizgi vb.) */
  subWrap?: string
  iconSize: number
  iconActive: string
  badge: (tone: 'warn' | 'danger') => string
}

export const defaultBadge = (tone: 'warn' | 'danger') =>
  [
    'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none flex-shrink-0 tabular-nums',
    tone === 'danger' ? 'bg-destructive/15 text-destructive' : 'bg-orange-500/20 text-orange-500',
  ].join(' ')

function balanceCls(balance: number) {
  return [
    'flex-shrink-0 tabular-nums text-[11px] font-semibold',
    balance < 0 ? 'text-destructive' : balance > 0 ? 'text-green-500' : 'text-muted-foreground',
  ].join(' ')
}

export function NavTree({ items, data, styles }: { items: NavItem[]; data: SidebarData; styles: NavTreeStyles }) {
  const {
    pathname, accounts, budgets, allCategories,
    isOnAccounts, accountsOpen, setAccountsOpen,
    isOnBudgets, budgetsOpen, setBudgetsOpen,
  } = data
  const counts = { dueCount: data.dueCount, paymentAlertCount: data.paymentAlertCount, draftCount: data.draftCount }

  const renderBadge = (item: NavItem) => {
    const b = navBadge(item, counts)
    return b ? <span title={b.title} className={styles.badge(b.tone)}>{b.count}</span> : null
  }

  return (
    <>
      {items.map(item => {
        if (item.expand) {
          const isAcc   = item.expand === 'accounts'
          const onPage  = isAcc ? isOnAccounts : isOnBudgets
          const open    = isAcc ? accountsOpen : budgetsOpen
          const setOpen = isAcc ? setAccountsOpen : setBudgetsOpen
          return (
            <div key={item.href}>
              <button type="button" onClick={() => setOpen(o => !o)} className={styles.row(onPage)} aria-expanded={open}>
                <Icon d={item.icon} size={styles.iconSize} className={onPage ? styles.iconActive : ''} />
                <span className="flex-1 text-left truncate">{item.label}</span>
                <Chevron open={open} size={11} />
              </button>
              {open && (
                <div className={styles.subWrap}>
                  <Link href={item.href} className={styles.sub(pathname === item.href)}>
                    <span className="flex-1 truncate">{isAcc ? 'Tüm Hesaplar' : 'Tüm Bütçeler'}</span>
                  </Link>
                  {isAcc
                    ? accounts.map(a => (
                        <Link key={a.id} href={`/accounts/${a.id}`} className={styles.sub(pathname === `/accounts/${a.id}`)}>
                          <AccountAvatar account={a} size="xs" />
                          <span className="flex-1 min-w-0 truncate">{a.name}</span>
                          <span className={balanceCls(a.balance)}>{formatWhole(a.balance, a.currency)}</span>
                        </Link>
                      ))
                    : budgets.map(b => {
                        // Kategorisi silinmiş bütçe de tıklanabilir kalsın ki düzeltilebilsin.
                        const { cats, label } = resolveBudgetCategories(b, allCategories)
                        return (
                          <Link key={b.id} href={`/budgets/${b.id}`} className={styles.sub(pathname === `/budgets/${b.id}`)}>
                            {cats.length > 0 && (
                              <span className="flex items-center gap-0.5 flex-shrink-0">
                                {cats.slice(0, 3).map(c => <CategoryIcon key={c.id} icon={c.icon} color={c.color} size={13} />)}
                              </span>
                            )}
                            <span className="flex-1 min-w-0 truncate">{label}</span>
                          </Link>
                        )
                      })}
                </div>
              )}
            </div>
          )
        }

        if (item.sub) {
          return (
            <div key={item.href} className={styles.subWrap}>
              <Link href={item.href} className={styles.sub(pathname === item.href)}>
                <span className="flex-1 truncate">{item.label}</span>
                {renderBadge(item)}
              </Link>
            </div>
          )
        }

        const active = pathname === item.href
        return (
          <Link key={item.href} href={item.href} className={styles.row(active)} aria-current={active ? 'page' : undefined}>
            <Icon d={item.icon} size={styles.iconSize} className={active ? styles.iconActive : ''} />
            <span className="flex-1 truncate">{item.label}</span>
            {renderBadge(item)}
          </Link>
        )
      })}
    </>
  )
}

/** Bir öğenin ve hemen ardından gelen alt sayfalarının rozet toplamı — alt
 *  sayfaların görünmediği dar görünümlerde (ikon rayı, bölüm rayı) kullanılır. */
export function rolledUpBadge(items: NavItem[], index: number, data: SidebarData) {
  const counts = { dueCount: data.dueCount, paymentAlertCount: data.paymentAlertCount, draftCount: data.draftCount }
  let count = 0
  let tone: 'warn' | 'danger' = 'warn'
  for (let i = index; i < items.length; i++) {
    if (i > index && !items[i].sub) break
    const b = navBadge(items[i], counts)
    if (b) {
      count += b.count
      if (b.tone === 'danger') tone = 'danger'
    }
  }
  return count > 0 ? { count, tone } : null
}
