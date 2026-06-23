'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard',    label: 'Ana Ekran', icon: '⊞' },
  { href: '/transactions', label: 'İşlemler',  icon: '⇅' },
  { href: '/accounts',     label: 'Hesaplar',  icon: '◫' },
  { href: '/investments',  label: 'Yatırım',   icon: '📈' },
  { href: '/reports',      label: 'Raporlar',  icon: '📊' },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border">
      <div className="flex">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex-1 flex flex-col items-center py-3 gap-0.5 text-[9px] font-semibold tracking-wide uppercase transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              ].join(' ')}
            >
              <span className="text-lg leading-tight">{icon}</span>
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
