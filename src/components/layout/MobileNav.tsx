'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { ALL_NAV_ITEMS, MOBILE_PRIMARY_HREFS, NAV_GROUPS, SETTINGS_ITEM, activeNavHref, type NavItem } from '@/components/layout/sidebar/nav'
import { useNavBadges, navBadge, type NavBadgeCounts } from '@/components/layout/sidebar/useNavBadges'
import { openCommandPalette } from '@/components/layout/command-palette/useCommandPalette'

/* ── Mobil alt menü ───────────────────────────────────────────────────────
   Kenar çubuğu lg altında gizli; bu yüzden alt menü dört ana sayfa + "Diğer"
   düğmesinden oluşur. "Diğer", alttan açılan bir sayfada kenar çubuğunun
   TÜM navigasyonunu (nav.ts — tek kaynak; gruplar, rozetler, ikonlar) ve
   Ayarlar'ı listeler; üstünde genel arama girişi var. */

const PRIMARY: NavItem[] = MOBILE_PRIMARY_HREFS.map(href => ALL_NAV_ITEMS.find(i => i.href === href)!)

const tabCls = (active: boolean) => [
  'flex-1 flex flex-col items-center justify-center py-2 gap-1 text-[10px] font-semibold tracking-wide transition-colors',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
  active ? 'text-primary' : 'text-muted-foreground',
].join(' ')

export function MobileNav() {
  const pathname = usePathname()
  const current  = activeNavHref(pathname)
  const [moreOpen, setMoreOpen] = useState(false)

  // Gezinti olunca sayfa kapanır (geri tuşu, bağlantı vb.) — render sırasında.
  const [prevPath, setPrevPath] = useState(pathname)
  if (prevPath !== pathname) {
    setPrevPath(pathname)
    if (moreOpen) setMoreOpen(false)
  }

  const onMore = current != null && !(MOBILE_PRIMARY_HREFS as readonly string[]).includes(current)

  return (
    <nav
      aria-label="Ana menü"
      className="lg:hidden print:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex h-14">
        {PRIMARY.map(item => {
          const active = current === item.href
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={tabCls(active)}>
              <Icon d={item.icon} size={21} />
              <span>{item.label}</span>
            </Link>
          )
        })}
        <DialogPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogPrimitive.Trigger className={tabCls(onMore || moreOpen)} aria-label="Diğer sayfalar">
            <Icon d={IC.more} size={21} />
            <span>Diğer</span>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="lg:hidden print:hidden fixed inset-0 z-[60] bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className={[
                'lg:hidden print:hidden fixed inset-x-0 bottom-0 z-[60] flex flex-col max-h-[85dvh]',
                'bg-background border-t border-border rounded-t-2xl shadow-xl outline-none',
                'pb-[env(safe-area-inset-bottom)]',
                'data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom duration-200',
              ].join(' ')}
            >
              {moreOpen && <MoreSheetBody current={current} onClose={() => setMoreOpen(false)} />}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>
    </nav>
  )
}

/* İçerik yalnız açıkken mount edilir: rozet hesapları (ödeme takvimi vb.)
   sayfa kapalıyken çalışmasın. */
function MoreSheetBody({ current, onClose }: { current: string | null; onClose: () => void }) {
  const counts = useNavBadges()

  return (
    <>
      {/* Tutamaç + başlık */}
      <div className="flex-shrink-0 pt-2 px-4">
        <div className="mx-auto w-10 h-1 rounded-full bg-border" aria-hidden />
        <div className="flex items-center justify-between pt-2 pb-2">
          <DialogPrimitive.Title className="text-sm font-bold text-foreground">Tüm Sayfalar</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Kapat"
            className="w-9 h-9 -mr-2 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          >
            <Icon d={IC.close} size={18} />
          </DialogPrimitive.Close>
        </div>
        <button
          type="button"
          onClick={() => { onClose(); openCommandPalette() }}
          className="w-full h-10 flex items-center gap-2 px-3 rounded-xl bg-secondary/60 border border-border text-sm text-muted-foreground text-left"
        >
          <Icon d={IC.search} size={16} />
          <span className="flex-1">Ara…</span>
        </button>
      </div>

      <nav aria-label="Tüm sayfalar" className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        {NAV_GROUPS.map(group => (
          <section key={group.title} aria-labelledby={`more-${group.title}`}>
            <h3 id={`more-${group.title}`} className="pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              {group.title}
            </h3>
            <ul className="grid grid-cols-2 gap-1.5">
              {group.items.map(item => (
                <li key={item.href}>
                  <SheetLink item={item} active={current === item.href} counts={counts} onClose={onClose} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section aria-label="Sistem">
          <ul className="grid grid-cols-2 gap-1.5 pt-4">
            <li>
              <SheetLink item={SETTINGS_ITEM} active={current === SETTINGS_ITEM.href} counts={counts} onClose={onClose} />
            </li>
          </ul>
        </section>
      </nav>
    </>
  )
}

function SheetLink({ item, active, counts, onClose }: {
  item: NavItem; active: boolean; counts: NavBadgeCounts; onClose: () => void
}) {
  const badge = navBadge(item, counts)
  return (
    <Link
      href={item.href}
      onClick={onClose}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-2.5 h-11 px-3 rounded-xl border text-[13px] transition-colors',
        active
          ? 'border-primary/40 bg-primary/10 text-foreground font-semibold'
          : 'border-border bg-secondary/30 text-foreground/90 font-medium active:bg-secondary',
      ].join(' ')}
    >
      <Icon d={item.icon} size={18} className={active ? 'text-primary' : 'text-muted-foreground'} />
      <span className="flex-1 min-w-0 truncate">{item.label}</span>
      {badge && (
        <span
          title={badge.title}
          aria-label={`${badge.count} — ${badge.title}`}
          className={[
            'text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none flex-shrink-0',
            badge.tone === 'danger' ? 'bg-destructive/15 text-destructive' : 'bg-orange-500/20 text-orange-500',
          ].join(' ')}
        >
          {badge.count}
        </span>
      )}
    </Link>
  )
}
