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
  /** Vadesi gelen tekrarlayan sayısını rozet olarak gösterir */
  badge?: 'due'
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
      { href: '/budgets',       label: 'Bütçeler',    icon: IC.budgets, expand: 'budgets' },
      { href: '/debts',         label: 'Borçlar',     icon: IC.debts },
      { href: '/recurring',     label: 'Tekrarlayan', icon: IC.recurring, badge: 'due' },
      { href: '/subscriptions', label: 'Abonelikler', icon: IC.subscriptions },
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
