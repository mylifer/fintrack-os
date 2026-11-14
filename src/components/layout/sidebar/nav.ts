import { IC } from './icons'

/* ── Ortak navigasyon şeması ──────────────────────────────────────────────
   Sıra, eski düz listeyle birebir aynı; yalnızca dört başlık altında
   gruplandı. Her iki görünüm varyantı da bu tek kaynaktan okur. */

export interface NavItem {
  href: string
  label: string
  icon: string
  /** Açılır alt liste — hesap veya bütçe satırlarını basar */
  expand?: 'accounts' | 'budgets'
  /** 'due': vadesi gelen tekrarlayan sayısı · 'payments': gecikmiş ya da
   *  bugün son günü olan kart/borç ödemesi sayısı */
  badge?: 'due' | 'payments' | 'drafts'
  /** Bir önceki öğenin alt sayfası: girintili, ikonsuz gösterilir */
  sub?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Genel',
    items: [
      { href: '/dashboard',    label: 'Ana Sayfa',   icon: IC.home },
      { href: '/accounts',     label: 'Hesaplar',    icon: IC.accounts, expand: 'accounts' },
      { href: '/transactions', label: 'İşlemler',    icon: IC.tx },
      { href: '/ekstre-yukle', label: 'Ekstre Yükle', icon: IC.upload },
      { href: '/ekstre-yukle/taslaklar', label: 'Yarım Kalanlar', icon: IC.upload, sub: true, badge: 'drafts' },
      { href: '/categories',   label: 'Kategoriler', icon: IC.categories },
      { href: '/tags',         label: 'Etiketler',   icon: IC.tags },
    ],
  },
  {
    title: 'Analiz',
    items: [
      { href: '/investments', label: 'Yatırımlar',    icon: IC.investments },
      { href: '/reports',     label: 'Raporlar',      icon: IC.reports },
      { href: '/statistics',  label: 'İstatistikler', icon: IC.stats },
      { href: '/forecast',    label: 'Tahmin',        icon: IC.forecast },
    ],
  },
  {
    title: 'Planlama',
    items: [
      { href: '/budgets',       label: 'Bütçeler',      icon: IC.budgets, expand: 'budgets' },
      { href: '/goals',         label: 'Hedefler',      icon: IC.goals },
      { href: '/debts',         label: 'Borçlar',       icon: IC.debts },
      { href: '/payments',      label: 'Ödeme Takibi',  icon: IC.payments, badge: 'payments' },
      { href: '/kart-takvimi',  label: 'Kart Takvimi',  icon: IC.cardCalendar },
      { href: '/recurring',     label: 'Tekrarlayan',   icon: IC.recurring, badge: 'due' },
      { href: '/subscriptions', label: 'Abonelikler',   icon: IC.subscriptions },
    ],
  },
  {
    title: 'Kişiler',
    items: [
      { href: '/aile-uyeleri', label: 'Aile Üyeleri', icon: IC.family },
      { href: '/alicilar',     label: 'Alıcılar',     icon: IC.recipient },
    ],
  },
]

/** Ayarlar kenar çubuğunda alt şeritte durur; mobil "Diğer" sayfası ve komut
 *  paleti de onu listelesin diye burada tanımlı (tek kaynak). */
export const SETTINGS_ITEM: NavItem = { href: '/settings', label: 'Ayarlar', icon: IC.settings }

/** Mobil alt menüde doğrudan duran sayfalar; kalanlar "Diğer" sayfasında. */
export const MOBILE_PRIMARY_HREFS = ['/dashboard', '/transactions', '/accounts', '/reports'] as const

/** Grup başlığıyla birlikte düz liste (Ayarlar sonda) — arama/palet için. */
export const ALL_NAV_ITEMS: (NavItem & { group: string })[] = [
  ...NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.title }))),
  { ...SETTINGS_ITEM, group: 'Sistem' },
]

/** Aktif sayfa eşleşmesi: tam yol ya da alt yol (detay sayfaları). */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/** Yola en özgül eşleşen öğenin href'i ("/ekstre-yukle/taslaklar" açıkken
 *  üst öğe "/ekstre-yukle" değil, alt öğe aktif sayılır). */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null
  for (const { href } of ALL_NAV_ITEMS) {
    if (isNavActive(pathname, href) && (!best || href.length > best.length)) best = href
  }
  return best
}
