'use client'

import { useState } from 'react'
import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'
import { SearchTrigger } from '@/components/layout/command-palette/SearchTrigger'
import { formatCompact } from '@/lib/utils/currency'
import { Icon, IC } from './icons'
import { NAV_GROUPS, activeNavHref } from './nav'
import { NavTree, defaultBadge, rolledUpBadge, type NavTreeStyles } from './NavTree'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: ÇİFT PANEL (varsayılan) ──────────────────────────────────────────────────
   Solda dört bölümlük dar bir ray (Genel · Analiz · Planlama · Kişiler),
   yanında yalnızca seçili bölümün sayfaları. Bölüm, açık sayfadan çıkarılır;
   raydan başka bir bölüme tıklamak yalnızca listeyi değiştirir (gezinmez) —
   bir sayfaya geçilince seçim yeniden sayfanın bölümüne döner. */

const GROUP_ICON: Record<string, string> = {
  Genel: IC.home,
  Analiz: IC.reports,
  Planlama: IC.budgets,
  Kişiler: IC.family,
}

const styles: NavTreeStyles = {
  row: active => [
    'flex items-center gap-2.5 w-full h-9 px-2.5 rounded-lg text-[13px] transition-colors duration-100',
    active
      ? 'bg-background text-foreground font-semibold shadow-sm ring-1 ring-border'
      : 'text-muted-foreground font-medium hover:text-foreground hover:bg-background/60',
  ].join(' '),
  sub: active => [
    'flex items-center gap-2 w-full h-8 pl-9 pr-2.5 rounded-lg text-xs transition-colors duration-100',
    active
      ? 'bg-background text-foreground font-semibold ring-1 ring-border'
      : 'text-muted-foreground font-medium hover:text-foreground hover:bg-background/60',
  ].join(' '),
  subWrap: 'flex flex-col gap-0.5 py-0.5',
  iconSize: 17,
  iconActive: 'text-primary',
  badge: defaultBadge,
}

function groupOf(pathname: string): string {
  const href = activeNavHref(pathname)
  return NAV_GROUPS.find(g => g.items.some(i => i.href === href))?.title ?? NAV_GROUPS[0].title
}

export function SidebarDual() {
  const data = useSidebarData()
  const { pathname, totalWealth, animTotalWealth, trendAmount, trendPct, handleSignOut } = data

  // Seçim yalnız bu yol için geçerli; yol değişince sayfanın bölümüne döner.
  const [picked, setPicked] = useState<{ path: string; group: string } | null>(null)
  const current = picked && picked.path === pathname ? picked.group : groupOf(pathname)
  const group = NAV_GROUPS.find(g => g.title === current) ?? NAV_GROUPS[0]
  const onSettings = pathname === '/settings'

  return (
    <aside className="hidden lg:flex print:hidden w-[272px] h-screen sticky top-0 shrink-0 border-r border-border">

      {/* ── Bölüm rayı ── */}
      <div className="w-[60px] flex-shrink-0 flex flex-col items-center bg-background border-r border-border">
        <div className="pt-4 pb-4">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-sm select-none">F</div>
        </div>
        <div className="flex flex-col items-center gap-2">
          {NAV_GROUPS.map(g => {
            const sel = g.title === group.title
            const alert = g.items.some((_, i) => rolledUpBadge(g.items, i, data))
            return (
              <button
                key={g.title}
                type="button"
                onClick={() => setPicked({ path: pathname, group: g.title })}
                aria-pressed={sel}
                className={[
                  'relative w-12 flex flex-col items-center gap-1 py-2 rounded-xl transition-colors',
                  sel ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                ].join(' ')}
              >
                <Icon d={GROUP_ICON[g.title] ?? IC.more} size={19} className={sel ? 'text-primary' : ''} />
                <span className="text-[9.5px] font-semibold leading-none">{g.title}</span>
                {alert && <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-orange-500 ring-2 ring-background" />}
              </button>
            )
          })}
        </div>
        <span className="flex-1" />
        <div className="flex flex-col items-center gap-1 pb-3">
          <ThemeToggle />
          <PrivacyToggle />
          <Link
            href="/settings"
            title="Ayarlar"
            aria-label="Ayarlar"
            className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors ${onSettings ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
          >
            <Icon d={IC.settings} size={18} />
          </Link>
          <button
            onClick={handleSignOut}
            title="Çıkış Yap"
            aria-label="Çıkış Yap"
            className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
          >
            <Icon d={IC.logout} size={18} />
          </button>
        </div>
      </div>

      {/* ── Bölüm paneli ── */}
      <div className="flex-1 min-w-0 flex flex-col bg-muted/50">
        <div className="px-3 pt-4 pb-2 flex-shrink-0"><WorkspaceSwitcher /></div>
        <div className="px-3 pb-3 flex-shrink-0"><SearchTrigger /></div>
        <div className="px-4 pb-2 text-[17px] font-bold tracking-tight text-foreground flex-shrink-0">{group.title}</div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
          <NavTree items={group.items} data={data} styles={styles} />
        </nav>
        <div className="m-3 p-3 rounded-xl bg-background border border-border flex-shrink-0">
          <div className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Net Varlık</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={`text-lg font-semibold tabular-nums ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
              {formatCompact(animTotalWealth)}
            </span>
            {trendAmount !== 0 && trendPct !== null && (
              <span className={`text-[10.5px] font-bold tabular-nums ${trendAmount >= 0 ? 'text-green-500' : 'text-destructive'}`} title="Geçen aya göre">
                {trendAmount >= 0 ? '▲' : '▼'} %{Math.abs(trendPct).toFixed(1).replace('.', ',')}
              </span>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
