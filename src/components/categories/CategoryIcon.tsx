'use client'

import { Icon } from '@iconify/react'
import {
  Wallet, CreditCard, Banknote, PiggyBank, Coins, TrendingUp, TrendingDown,
  Receipt, HandCoins, BadgePercent, Landmark, BadgeDollarSign,
  ShoppingCart, ShoppingBag, Store, Tag, Package, Shirt, Watch, Gem, Scissors, Backpack,
  UtensilsCrossed, Utensils, Coffee, Pizza, Apple, ChefHat, Salad, Wine, IceCream,
  Car, Bus, Train, Plane, Fuel, Zap, ParkingCircle, Bike, Ship, Truck,
  Home, Hammer, Wrench, Lightbulb, Droplets, Flame, Wifi, Phone, Tv, Key, Sofa, Building,
  Heart, Activity, Pill, Dumbbell, Baby, Brain, Stethoscope,
  Music, Gamepad2, Film, BookOpen, Ticket, Headphones, Camera,
  Globe, Shield, Scale, Briefcase, GraduationCap, Gift, Star, Sun, Leaf,
  Cigarette, Sparkles, RefreshCw, MapPin, Monitor, Pencil,
  type LucideIcon,
} from 'lucide-react'

/* ── Legacy Lucide map (backward compat for existing DB data) ─────── */
export const ICON_MAP: Record<string, LucideIcon> = {
  Wallet, CreditCard, Banknote, PiggyBank, Coins, TrendingUp, TrendingDown,
  Receipt, HandCoins, BadgePercent, Landmark, BadgeDollarSign,
  ShoppingCart, ShoppingBag, Store, Tag, Package, Shirt, Watch, Gem, Scissors, Backpack,
  UtensilsCrossed, Utensils, Coffee, Pizza, Apple, ChefHat, Salad, Wine, IceCream,
  Car, Bus, Train, Plane, Fuel, Zap, ParkingCircle, Bike, Ship, Truck,
  Home, Hammer, Wrench, Lightbulb, Droplets, Flame, Wifi, Phone, Tv, Key, Sofa, Building,
  Heart, Activity, Pill, Dumbbell, Baby, Brain, Stethoscope,
  Music, Gamepad2, Film, BookOpen, Ticket, Headphones, Camera,
  Globe, Shield, Scale, Briefcase, GraduationCap, Gift, Star, Sun, Leaf,
  Cigarette, Sparkles, RefreshCw, MapPin, Monitor, Pencil,
}

/* ── Noto icon list for the picker ───────────────────────────────── */
export const NOTO_ICON_LIST: { name: string; label: string; group: string }[] = [
  // Finans
  { name: 'noto:money-bag',                       label: 'Para',         group: 'Finans' },
  { name: 'noto:credit-card',                     label: 'Kart',         group: 'Finans' },
  { name: 'noto:dollar-banknote',                 label: 'Banknot',      group: 'Finans' },
  { name: 'noto:chart-increasing',                label: 'Yatırım',      group: 'Finans' },
  { name: 'noto:bank',                            label: 'Banka',        group: 'Finans' },
  { name: 'noto:briefcase',                       label: 'İş / Maaş',   group: 'Finans' },
  { name: 'noto:wrapped-gift',                    label: 'Hediye',       group: 'Finans' },
  { name: 'noto:red-heart',                       label: 'Bağış',        group: 'Finans' },
  { name: 'noto:receipt',                         label: 'Fiş',          group: 'Finans' },
  { name: 'noto:money-with-wings',                label: 'Cashback',     group: 'Finans' },
  { name: 'noto:balance-scale',                   label: 'Hukuk',        group: 'Finans' },
  { name: 'noto:package',                         label: 'Diğer',        group: 'Finans' },

  // Yemek
  { name: 'noto:fork-and-knife-with-plate',       label: 'Restoran',     group: 'Yemek' },
  { name: 'noto:shopping-cart',                   label: 'Market',       group: 'Yemek' },
  { name: 'noto:hot-beverage',                    label: 'Kahve',        group: 'Yemek' },
  { name: 'noto:beer-mug',                        label: 'İçki',         group: 'Yemek' },
  { name: 'noto:fork-and-knife',                  label: 'Yemek',        group: 'Yemek' },
  { name: 'noto:pizza',                           label: 'Pizza',        group: 'Yemek' },
  { name: 'noto:birthday-cake',                   label: 'Tatlı',        group: 'Yemek' },
  { name: 'noto:tropical-drink',                  label: 'İçecek',       group: 'Yemek' },

  // Ulaşım
  { name: 'noto:automobile',                      label: 'Araç',         group: 'Ulaşım' },
  { name: 'noto:bus',                             label: 'Otobüs',       group: 'Ulaşım' },
  { name: 'noto:taxi',                            label: 'Taksi',        group: 'Ulaşım' },
  { name: 'noto:train',                           label: 'Tren',         group: 'Ulaşım' },
  { name: 'noto:airplane',                        label: 'Uçak',         group: 'Ulaşım' },
  { name: 'noto:fuel-pump',                       label: 'Yakıt',        group: 'Ulaşım' },
  { name: 'noto:p-button',                        label: 'Otopark',      group: 'Ulaşım' },
  { name: 'noto:motorway',                        label: 'HGS',          group: 'Ulaşım' },
  { name: 'noto:bicycle',                         label: 'Bisiklet',     group: 'Ulaşım' },
  { name: 'noto:ferry',                           label: 'Gemi',         group: 'Ulaşım' },

  // Ev
  { name: 'noto:house',                           label: 'Ev',           group: 'Ev' },
  { name: 'noto:key',                             label: 'Kira',         group: 'Ev' },
  { name: 'noto:hammer',                          label: 'Tadilat',      group: 'Ev' },
  { name: 'noto:wrench',                          label: 'Tamir',        group: 'Ev' },
  { name: 'noto:high-voltage',                    label: 'Elektrik',     group: 'Ev' },
  { name: 'noto:droplet',                         label: 'Su',           group: 'Ev' },
  { name: 'noto:fire',                            label: 'Doğalgaz',     group: 'Ev' },
  { name: 'noto:globe-with-meridians',            label: 'İnternet',     group: 'Ev' },
  { name: 'noto:mobile-phone',                    label: 'Telefon',      group: 'Ev' },
  { name: 'noto:television',                      label: 'TV',           group: 'Ev' },
  { name: 'noto:couch-and-lamp',                  label: 'Mobilya',      group: 'Ev' },
  { name: 'noto:office-building',                 label: 'Aidat',        group: 'Ev' },
  { name: 'noto:sparkles',                        label: 'Temizlik',     group: 'Ev' },
  { name: 'noto:shield',                          label: 'Güvenlik',     group: 'Ev' },

  // Sağlık
  { name: 'noto:hospital',                        label: 'Hastane',      group: 'Sağlık' },
  { name: 'noto:stethoscope',                     label: 'Doktor',       group: 'Sağlık' },
  { name: 'noto:pill',                            label: 'İlaç',         group: 'Sağlık' },
  { name: 'noto:brain',                           label: 'Psikoloji',    group: 'Sağlık' },
  { name: 'noto:tooth',                           label: 'Diş',          group: 'Sağlık' },
  { name: 'noto:baby',                            label: 'Bebek',        group: 'Sağlık' },
  { name: 'noto:person-running',                  label: 'Spor',         group: 'Sağlık' },
  { name: 'noto:dumbbell',                        label: 'Fitness',      group: 'Sağlık' },

  // Eğlence
  { name: 'noto:video-game',                      label: 'Oyun',         group: 'Eğlence' },
  { name: 'noto:musical-notes',                   label: 'Müzik',        group: 'Eğlence' },
  { name: 'noto:clapper-board',                   label: 'Sinema',       group: 'Eğlence' },
  { name: 'noto:books',                           label: 'Kitap',        group: 'Eğlence' },
  { name: 'noto:ticket',                          label: 'Etkinlik',     group: 'Eğlence' },
  { name: 'noto:headphone',                       label: 'Podcast',      group: 'Eğlence' },
  { name: 'noto:camera',                          label: 'Fotoğraf',     group: 'Eğlence' },
  { name: 'noto:party-popper',                    label: 'Parti',        group: 'Eğlence' },
  { name: 'noto:sun',                             label: 'Tatil',        group: 'Eğlence' },

  // Alışveriş
  { name: 'noto:shopping-bags',                   label: 'Alışveriş',    group: 'Alışveriş' },
  { name: 'noto:t-shirt',                         label: 'Giyim',        group: 'Alışveriş' },
  { name: 'noto:laptop-computer',                 label: 'Laptop',       group: 'Alışveriş' },
  { name: 'noto:desktop-computer',               label: 'Bilgisayar',   group: 'Alışveriş' },
  { name: 'noto:pencil',                          label: 'Kırtasiye',    group: 'Alışveriş' },
  { name: 'noto:lipstick',                        label: 'Kozmetik',     group: 'Alışveriş' },
  { name: 'noto:cigarette',                       label: 'Tütün',        group: 'Alışveriş' },
  { name: 'noto:ring',                            label: 'Aksesuar',     group: 'Alışveriş' },

  // Eğitim & Diğer
  { name: 'noto:graduation-cap',                  label: 'Eğitim',       group: 'Diğer' },
  { name: 'noto:star',                            label: 'Favori',       group: 'Diğer' },
  { name: 'noto:leaf-fluttering-in-wind',         label: 'Doğa',         group: 'Diğer' },
  { name: 'noto:counterclockwise-arrows-button',  label: 'Abonelik',     group: 'Diğer' },
  { name: 'noto:telephone-receiver',              label: 'Telefon',      group: 'Diğer' },
]

/* ── CategoryIcon component ───────────────────────────────────────── */
interface CategoryIconProps {
  icon: string
  color?: string
  size?: number
  className?: string
}

export function CategoryIcon({ icon, color = '#6B8F80', size = 16, className = '' }: CategoryIconProps) {
  const containerSize = size + 10

  // Iconify icon (e.g. "noto:automobile", "flat-color-icons:money")
  if (icon.includes(':')) {
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: containerSize, height: containerSize }}
      >
        <Icon icon={icon} width={containerSize - 4} height={containerSize - 4} />
      </span>
    )
  }

  // Legacy Lucide icon name
  const LIcon = ICON_MAP[icon]
  if (LIcon) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-xl flex-shrink-0 ${className}`}
        style={{ width: containerSize, height: containerSize, background: color }}
      >
        <LIcon size={size} color="white" strokeWidth={1.75} />
      </span>
    )
  }

  // Emoji / text fallback
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl flex-shrink-0 ${className}`}
      style={{ width: containerSize, height: containerSize, background: `${color}22`, fontSize: size * 0.8 }}
    >
      {icon || '📦'}
    </span>
  )
}

/* ── Label helper ─────────────────────────────────────────────────── */
export function formatCategoryLabel(cat: { icon: string; name: string }): string {
  return (ICON_MAP[cat.icon] || cat.icon.includes(':')) ? cat.name : `${cat.icon} ${cat.name}`
}
