'use client'

import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'
import { SearchTrigger } from '@/components/layout/command-palette/SearchTrigger'
import { formatCompact, formatCurrency } from '@/lib/utils/currency'
import { Icon, IC } from './icons'
import { NAV_GROUPS } from './nav'
import { NavTree, defaultBadge, type NavTreeStyles } from './NavTree'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: YÜZEN KART ──────────────────────────────────────────────────
   Panel ekran kenarına yapışmaz: 10px boşlukla duran, gölgeli ve yuvarlak
   köşeli bir kart. Net varlık en üstte, bir "hero" kartı olarak durur —
   uygulamaya her girişte ilk görülen sayı. Aktif sayfa dolgun turkuaz hap;
   üzerindeki metin primary-foreground (koyu petrol), her iki temada okunur. */

const styles: NavTreeStyles = {
  row: active => [
    'flex items-center gap-2.5 w-full h-9 px-3 rounded-full text-[13px] transition-colors duration-100',
    active
      ? 'bg-primary text-primary-foreground font-semibold shadow-sm shadow-primary/30'
      : 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary',
  ].join(' '),
  sub: active => [
    'flex items-center gap-2 w-full h-8 pl-10 pr-3 rounded-full text-xs transition-colors duration-100',
    active
      ? 'bg-primary/15 text-foreground font-semibold'
      : 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary',
  ].join(' '),
  subWrap: 'flex flex-col gap-0.5 py-0.5',
  iconSize: 17,
  iconActive: '',
  badge: defaultBadge,
}

export function SidebarFloating() {
  const data = useSidebarData()
  const { pathname, totalWealth, animTotalWealth, trendAmount, trendPct, handleSignOut } = data
  const onSettings = pathname === '/settings'

  return (
    <aside className="hidden lg:flex print:hidden w-[264px] h-screen sticky top-0 shrink-0 p-2.5 pr-0">
      <div className="flex-1 flex flex-col min-h-0 rounded-[22px] bg-card border border-border shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)] overflow-hidden">

        {/* ── Logo + çalışma alanı ── */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-black text-sm select-none flex-shrink-0">
            F
          </div>
          <div className="flex-1 min-w-0"><WorkspaceSwitcher /></div>
        </div>

        {/* ── Net varlık hero ── */}
        <div className="mx-3 mt-1 mb-3 p-4 rounded-2xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent border border-primary/20 flex-shrink-0">
          <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Net Varlık</div>
          <div className={`text-[26px] leading-tight font-semibold tabular-nums mt-1 ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatCompact(animTotalWealth)}
          </div>
          {trendAmount !== 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={[
                  'inline-flex items-center gap-1 text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full',
                  trendAmount >= 0 ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-destructive/15 text-destructive',
                ].join(' ')}
              >
                {trendAmount >= 0 ? '▲' : '▼'}
                {trendPct !== null ? ` %${Math.abs(trendPct).toFixed(1).replace('.', ',')}` : ` ${formatCurrency(Math.abs(trendAmount))}`}
              </span>
              <span className="text-[11px] text-muted-foreground">geçen aya göre</span>
            </div>
          )}
        </div>

        <div className="px-3 pb-1 flex-shrink-0"><SearchTrigger /></div>

        {/* ── Nav ── */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map(group => (
            <div key={group.title} className="flex flex-col gap-0.5">
              <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-muted-foreground/80">{group.title}</div>
              <NavTree items={group.items} data={data} styles={styles} />
            </div>
          ))}
        </nav>

        {/* ── Alt: ikon düğmeleri ── */}
        <div className="flex items-center gap-1 px-3 py-2.5 border-t border-border flex-shrink-0">
          <Link
            href="/settings"
            title="Ayarlar"
            className={[
              'flex items-center gap-2 h-9 px-3 rounded-full text-xs font-semibold transition-colors',
              onSettings ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
            ].join(' ')}
          >
            <Icon d={IC.settings} size={16} />
            Ayarlar
          </Link>
          <span className="flex-1" />
          <ThemeToggle />
          <PrivacyToggle />
          <button
            onClick={handleSignOut}
            title="Çıkış Yap"
            aria-label="Çıkış Yap"
            className="w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Icon d={IC.logout} size={17} />
          </button>
        </div>
      </div>
    </aside>
  )
}
