'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { PrivacyToggle } from '@/components/layout/PrivacyToggle'
import { SearchTrigger } from '@/components/layout/command-palette/SearchTrigger'
import { openCommandPalette } from '@/components/layout/command-palette/useCommandPalette'
import { formatAxisCompact, formatCompact } from '@/lib/utils/currency'
import { Icon, IC } from './icons'
import { NAV_GROUPS, isNavActive, type NavItem } from './nav'
import { NavTree, defaultBadge, rolledUpBadge, type NavTreeStyles } from './NavTree'
import { useSidebarData } from './useSidebarData'

/* ── Varyant: İKON RAYI ───────────────────────────────────────────────────
   Varsayılan hâli 68px'lik ikon rayı: içerik alanına en çok yer bırakan
   düzen. Etiketler imleç üstündeyken sağda bir ipucu olarak çıkar. Alttaki
   düğme paneli tam genişliğe açar (tercih bu tarayıcıda hatırlanır).
   Rayda alt sayfalar gösterilmez; rozetleri üst öğede toplanır. */

const KEY = 'fintrack-rail-expanded'
const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
function getSnapshot() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
function setExpanded(v: boolean) {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* özel mod: yalnız bu oturum */ }
  listeners.forEach(l => l())
}

const wideStyles: NavTreeStyles = {
  row: active => [
    'flex items-center gap-2.5 w-full h-8 px-3 rounded-lg text-[13px] transition-colors duration-100',
    active ? 'bg-primary/10 text-foreground font-semibold' : 'text-muted-foreground font-medium hover:text-foreground hover:bg-secondary/60',
  ].join(' '),
  sub: active => [
    'flex items-center gap-2 w-full h-7 pl-[38px] pr-3 rounded-lg text-xs transition-colors duration-100',
    active ? 'text-foreground font-semibold bg-secondary/70' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
  ].join(' '),
  iconSize: 17,
  iconActive: 'text-primary',
  badge: defaultBadge,
}

/** Yola en özgül eşleşen ÜST öğe (alt sayfadayken ebeveyn vurgulanır). */
function activeTopHref(pathname: string): string | null {
  let best: string | null = null
  for (const g of NAV_GROUPS) for (const i of g.items) {
    if (!i.sub && isNavActive(pathname, i.href) && (!best || i.href.length > best.length)) best = i.href
  }
  return best
}

export function SidebarRail() {
  const data = useSidebarData()
  const { pathname, totalWealth, animTotalWealth, handleSignOut } = data
  const expanded = useSyncExternalStore(subscribe, getSnapshot, () => false)
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const showTip = (label: string) => (e: React.MouseEvent | React.FocusEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2 })
  }
  const hideTip = () => setTip(null)
  const tipProps = (label: string) => ({
    onMouseEnter: showTip(label), onMouseLeave: hideTip, onFocus: showTip(label), onBlur: hideTip, 'aria-label': label,
  })

  const toggle = (
    <button
      type="button"
      onClick={() => { setExpanded(!expanded); hideTip() }}
      title={expanded ? 'Rayı daralt' : 'Paneli genişlet'}
      aria-label={expanded ? 'Rayı daralt' : 'Paneli genişlet'}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0"
    >
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={17} height={17} aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <path strokeLinecap="round" d="M9 4v16" />
        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'm15.5 10-2 2 2 2' : 'm13.5 10 2 2-2 2'} />
      </svg>
    </button>
  )

  /* ── Açık hâl: klasik etiketli panel ── */
  if (expanded) {
    return (
      <aside className="hidden lg:flex print:hidden flex-col w-60 h-screen sticky top-0 shrink-0 bg-background border-r border-border">
        <div className="flex items-center gap-2 px-3 pt-4 pb-2 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-sm select-none flex-shrink-0">F</div>
          <div className="flex-1 min-w-0"><WorkspaceSwitcher /></div>
        </div>
        <div className="px-3 pb-1 flex-shrink-0"><SearchTrigger /></div>
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              {gi > 0 && <div className="h-px bg-border mx-3 my-2" />}
              <NavTree items={group.items} data={data} styles={wideStyles} />
            </div>
          ))}
        </nav>
        <div className="px-3 py-2 border-t border-border flex-shrink-0">
          <div className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Net Varlık</div>
          <div className={`text-base font-semibold tabular-nums ${totalWealth >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {formatCompact(animTotalWealth)}
          </div>
        </div>
        <div className="flex items-center gap-0.5 px-2 py-2 border-t border-border flex-shrink-0">
          {toggle}
          <span className="flex-1" />
          <Link href="/settings" title="Ayarlar" aria-label="Ayarlar" className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${pathname === '/settings' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
            <Icon d={IC.settings} size={17} />
          </Link>
          <ThemeToggle />
          <PrivacyToggle />
          <button onClick={handleSignOut} title="Çıkış Yap" aria-label="Çıkış Yap" className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors">
            <Icon d={IC.logout} size={17} />
          </button>
        </div>
      </aside>
    )
  }

  /* ── Dar hâl: ikon rayı ── */
  const activeHref = activeTopHref(pathname)
  const railBtn = (active: boolean) => [
    'relative w-10 h-9 flex-shrink-0 flex items-center justify-center rounded-xl transition-colors duration-100',
    active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
  ].join(' ')

  const renderItem = (item: NavItem, items: NavItem[], idx: number) => {
    if (item.sub) return null
    const active = activeHref === item.href
    const badge = rolledUpBadge(items, idx, data)
    return (
      <Link key={item.href} href={item.href} className={railBtn(active)} aria-current={active ? 'page' : undefined} {...tipProps(item.label)}>
        <Icon d={item.icon} size={19} />
        {badge && (
          <span className={`absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold leading-4 text-center text-white ${badge.tone === 'danger' ? 'bg-destructive' : 'bg-orange-500'}`}>
            {badge.count}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside className="hidden lg:flex print:hidden flex-col items-center w-[68px] h-screen sticky top-0 shrink-0 bg-background border-r border-border">
      <div className="pt-3 pb-2 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-sm select-none">F</div>
      </div>
      <button type="button" onClick={openCommandPalette} className={railBtn(false)} {...tipProps('Ara (Ctrl K)')}>
        <Icon d={IC.search} size={18} />
      </button>

      <nav className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-0.5 py-1.5 [scrollbar-width:none]">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title} className="flex flex-col items-center gap-0.5">
            {gi > 0 && <div className="w-6 h-px bg-border my-1" />}
            {group.items.map((item, idx) => renderItem(item, group.items, idx))}
          </div>
        ))}
      </nav>

      <div className="relative flex flex-col items-center gap-0.5 py-2 border-t border-border w-full flex-shrink-0">
        <div className="text-[10px] font-bold tabular-nums text-center leading-tight px-1 py-1 text-foreground" {...tipProps('Net Varlık')}>
          <span className={totalWealth >= 0 ? '' : 'text-destructive'}>{formatAxisCompact(animTotalWealth)}</span>
        </div>
        <Link href="/settings" className={railBtn(pathname === '/settings')} {...tipProps('Ayarlar')}>
          <Icon d={IC.settings} size={18} />
        </Link>
        <button type="button" onClick={() => { setMenuOpen(o => !o); hideTip() }} aria-expanded={menuOpen} className={railBtn(menuOpen)} {...tipProps('Diğer')}>
          <svg fill="currentColor" viewBox="0 0 24 24" width={18} height={18} aria-hidden>
            <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
        {toggle}

        {/* Tema · gizlilik · çıkış: rayda yer kaplamasın diye küçük bir menüde. */}
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            <div className="absolute left-[60px] bottom-12 z-50 flex items-center gap-0.5 p-1 rounded-xl bg-popover border border-border shadow-lg">
              <ThemeToggle />
              <PrivacyToggle />
              <button onClick={handleSignOut} title="Çıkış Yap" aria-label="Çıkış Yap" className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors">
                <Icon d={IC.logout} size={17} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* İpucu: nav kaydırılabilir olduğu için (overflow taşanları keser) sabit konumda çizilir. */}
      {tip && (
        <div
          role="tooltip"
          className="fixed left-[74px] z-50 -translate-y-1/2 px-2.5 py-1 rounded-md bg-foreground text-background text-xs font-semibold whitespace-nowrap shadow-lg pointer-events-none"
          style={{ top: tip.top }}
        >
          {tip.label}
        </div>
      )}
    </aside>
  )
}
