'use client'

import { useState } from 'react'
import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'
import { SearchTrigger } from '@/components/layout/command-palette/SearchTrigger'
import { formatCompact } from '@/lib/utils/currency'
import { Icon, Chevron, IC } from './icons'
import { NAV_GROUPS, isNavActive } from './nav'
import { NavTree, defaultBadge, type NavTreeStyles } from './NavTree'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: KOYU KONTRAST ───────────────────────────────────────────────
   Panel temadan bağımsız hep koyudur: <aside> `dark` sınıfını taşır, böylece
   içerideki tüm token'lar (ve WorkspaceSwitcher gibi alt bileşenler) koyu
   değerleri okur. Gruplar katlanabilir; aktif sayfanın grubu her zaman açık
   kalır. Aktif satır: sol kenarda parlayan turkuaz ray + hafif turkuaz zemin. */

const styles: NavTreeStyles = {
  row: active => [
    'relative flex items-center gap-2.5 w-full h-8 pl-4 pr-3 text-[13px] transition-colors duration-100',
    active
      ? "bg-gradient-to-r from-primary/20 to-transparent text-white font-semibold before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-r-full before:bg-primary before:shadow-[0_0_12px_2px_var(--primary)]"
      : 'text-white/55 font-medium hover:text-white hover:bg-white/5',
  ].join(' '),
  sub: active => [
    'relative flex items-center gap-2 w-full h-7 pl-[42px] pr-3 text-xs transition-colors duration-100',
    active ? 'text-primary font-semibold' : 'text-white/45 hover:text-white hover:bg-white/5',
  ].join(' '),
  iconSize: 16,
  iconActive: 'text-primary',
  badge: defaultBadge,
}

export function SidebarContrast() {
  const data = useSidebarData()
  const { pathname, totalWealth, animTotalWealth, trendAmount, trendPct, handleSignOut } = data
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const onSettings = pathname === '/settings'

  return (
    <aside className="dark hidden lg:flex print:hidden flex-col w-64 h-screen sticky top-0 shrink-0 bg-[#0b1214] text-white border-r border-white/5">

      {/* ── Logo ── */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-3 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-black text-[13px] select-none shadow-[0_0_18px_-2px_var(--primary)]">
          F
        </div>
        <span className="text-[15px] font-bold tracking-tight">fin<span className="text-primary">track</span></span>
      </div>

      <div className="px-3 pb-2 flex-shrink-0"><WorkspaceSwitcher dense /></div>
      <div className="px-3 pb-2 flex-shrink-0"><SearchTrigger dense /></div>

      {/* ── Katlanabilir gruplar ── */}
      <nav className="flex-1 min-h-0 overflow-y-auto pb-3">
        {NAV_GROUPS.map(group => {
          const hasActive = group.items.some(i => isNavActive(pathname, i.href))
          const open = hasActive || !collapsed[group.title]
          return (
            <div key={group.title} className="mt-1">
              <button
                type="button"
                onClick={() => !hasActive && setCollapsed(c => ({ ...c, [group.title]: !c[group.title] }))}
                aria-expanded={open}
                className="w-full flex items-center gap-2 px-4 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/35 hover:text-white/70 transition-colors"
              >
                <span className="flex-1 text-left">{group.title}</span>
                {!open && <span className="text-[10px] font-semibold tabular-nums normal-case tracking-normal">{group.items.filter(i => !i.sub).length}</span>}
                <span className={hasActive ? 'invisible' : ''}><Chevron open={open} size={10} /></span>
              </button>
              {open && <NavTree items={group.items} data={data} styles={styles} />}
            </div>
          )
        })}
      </nav>

      {/* ── Net varlık ── */}
      <div className="mx-3 mb-3 p-3 rounded-xl bg-white/[0.04] border border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-white/40">Net Varlık</span>
          {trendAmount !== 0 && trendPct !== null && (
            <span className={`text-[10.5px] font-bold tabular-nums ${trendAmount >= 0 ? 'text-emerald-400' : 'text-red-400'}`} title="Geçen aya göre">
              {trendAmount >= 0 ? '▲' : '▼'} %{Math.abs(trendPct).toFixed(1).replace('.', ',')}
            </span>
          )}
        </div>
        <div className={`text-xl font-semibold tabular-nums mt-0.5 ${totalWealth >= 0 ? 'text-white' : 'text-red-400'}`}>
          {formatCompact(animTotalWealth)}
        </div>
      </div>

      {/* ── Alt şerit ── */}
      <div className="h-11 flex items-center gap-1 px-2 border-t border-white/10 flex-shrink-0">
        <Link
          href="/settings"
          className={[
            'flex items-center gap-2 h-8 px-2.5 rounded-md text-xs font-medium transition-colors',
            onSettings ? 'text-primary bg-primary/10' : 'text-white/55 hover:text-white hover:bg-white/5',
          ].join(' ')}
        >
          <Icon d={IC.settings} size={15} /> Ayarlar
        </Link>
        <span className="flex-1" />
        <ThemeToggle />
        <PrivacyToggle />
        <button
          onClick={handleSignOut}
          title="Çıkış Yap"
          aria-label="Çıkış Yap"
          className="w-9 h-9 flex items-center justify-center rounded-md text-white/55 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Icon d={IC.logout} size={16} />
        </button>
      </div>
    </aside>
  )
}
