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

/* ── Icon map ─────────────────────────────────────────────────────── */
export const ICON_MAP: Record<string, LucideIcon> = {
  // Finans
  Wallet, CreditCard, Banknote, PiggyBank, Coins, TrendingUp, TrendingDown,
  Receipt, HandCoins, BadgePercent, Landmark, BadgeDollarSign,
  // Alışveriş
  ShoppingCart, ShoppingBag, Store, Tag, Package, Shirt, Watch, Gem, Scissors, Backpack,
  // Yemek
  UtensilsCrossed, Utensils, Coffee, Pizza, Apple, ChefHat, Salad, Wine, IceCream,
  // Ulaşım
  Car, Bus, Train, Plane, Fuel, Zap, ParkingCircle, Bike, Ship, Truck,
  // Ev
  Home, Hammer, Wrench, Lightbulb, Droplets, Flame, Wifi, Phone, Tv, Key, Sofa, Building,
  // Sağlık
  Heart, Activity, Pill, Dumbbell, Baby, Brain, Stethoscope,
  // Eğlence
  Music, Gamepad2, Film, BookOpen, Ticket, Headphones, Camera,
  // Diğer
  Globe, Shield, Scale, Briefcase, GraduationCap, Gift, Star, Sun, Leaf,
  Cigarette, Sparkles, RefreshCw, MapPin, Monitor, Pencil,
}

/* ── Curated picker list ──────────────────────────────────────────── */
export const CATEGORY_ICON_LIST: { name: string; label: string; group: string }[] = [
  { name: 'Wallet',          label: 'Cüzdan',      group: 'Finans' },
  { name: 'CreditCard',      label: 'Kart',         group: 'Finans' },
  { name: 'Banknote',        label: 'Para',         group: 'Finans' },
  { name: 'PiggyBank',       label: 'Birikim',      group: 'Finans' },
  { name: 'Coins',           label: 'Bozuk Para',   group: 'Finans' },
  { name: 'TrendingUp',      label: 'Artış',        group: 'Finans' },
  { name: 'TrendingDown',    label: 'Düşüş',        group: 'Finans' },
  { name: 'Receipt',         label: 'Fiş/Fatura',  group: 'Finans' },
  { name: 'HandCoins',       label: 'Ödeme',        group: 'Finans' },
  { name: 'BadgePercent',    label: 'İndirim',      group: 'Finans' },
  { name: 'Landmark',        label: 'Banka',        group: 'Finans' },
  { name: 'BadgeDollarSign', label: 'Döviz',        group: 'Finans' },

  { name: 'ShoppingCart',    label: 'Market',       group: 'Alışveriş' },
  { name: 'ShoppingBag',     label: 'Alışveriş',    group: 'Alışveriş' },
  { name: 'Store',           label: 'Mağaza',       group: 'Alışveriş' },
  { name: 'Tag',             label: 'Etiket',       group: 'Alışveriş' },
  { name: 'Package',         label: 'Koli',         group: 'Alışveriş' },
  { name: 'Shirt',           label: 'Giysi',        group: 'Alışveriş' },
  { name: 'Watch',           label: 'Saat',         group: 'Alışveriş' },
  { name: 'Gem',             label: 'Mücevher',     group: 'Alışveriş' },
  { name: 'Scissors',        label: 'Kuaför',       group: 'Alışveriş' },
  { name: 'Backpack',        label: 'Çanta',        group: 'Alışveriş' },

  { name: 'UtensilsCrossed', label: 'Restoran',     group: 'Yemek' },
  { name: 'Utensils',        label: 'Yemek',        group: 'Yemek' },
  { name: 'Coffee',          label: 'Kahve',        group: 'Yemek' },
  { name: 'Pizza',           label: 'Pizza',        group: 'Yemek' },
  { name: 'Apple',           label: 'Meyve/Sebze',  group: 'Yemek' },
  { name: 'ChefHat',         label: 'Ev Yemeği',    group: 'Yemek' },
  { name: 'Salad',           label: 'Salata',       group: 'Yemek' },
  { name: 'Wine',            label: 'İçki',         group: 'Yemek' },
  { name: 'IceCream',        label: 'Tatlı',        group: 'Yemek' },

  { name: 'Car',             label: 'Araç',         group: 'Ulaşım' },
  { name: 'Bus',             label: 'Otobüs',       group: 'Ulaşım' },
  { name: 'Train',           label: 'Tren',         group: 'Ulaşım' },
  { name: 'Plane',           label: 'Uçak',         group: 'Ulaşım' },
  { name: 'Fuel',            label: 'Yakıt',        group: 'Ulaşım' },
  { name: 'Zap',             label: 'Şarj',         group: 'Ulaşım' },
  { name: 'ParkingCircle',   label: 'Otopark',      group: 'Ulaşım' },
  { name: 'Bike',            label: 'Bisiklet',     group: 'Ulaşım' },
  { name: 'Ship',            label: 'Gemi',         group: 'Ulaşım' },
  { name: 'Truck',           label: 'Kamyon',       group: 'Ulaşım' },
  { name: 'MapPin',          label: 'HGS/Geçiş',   group: 'Ulaşım' },

  { name: 'Home',            label: 'Ev',           group: 'Ev' },
  { name: 'Key',             label: 'Kira',         group: 'Ev' },
  { name: 'Hammer',          label: 'Tadilat',      group: 'Ev' },
  { name: 'Wrench',          label: 'Tamir',        group: 'Ev' },
  { name: 'Lightbulb',       label: 'Elektrik',     group: 'Ev' },
  { name: 'Droplets',        label: 'Su',           group: 'Ev' },
  { name: 'Flame',           label: 'Doğalgaz',     group: 'Ev' },
  { name: 'Wifi',            label: 'İnternet',     group: 'Ev' },
  { name: 'Phone',           label: 'Telefon',      group: 'Ev' },
  { name: 'Tv',              label: 'TV',           group: 'Ev' },
  { name: 'Sofa',            label: 'Mobilya',      group: 'Ev' },
  { name: 'Building',        label: 'Bina/Aidat',   group: 'Ev' },

  { name: 'Heart',           label: 'Sağlık',       group: 'Sağlık' },
  { name: 'Activity',        label: 'Spor',         group: 'Sağlık' },
  { name: 'Pill',            label: 'İlaç',         group: 'Sağlık' },
  { name: 'Dumbbell',        label: 'Fitness',      group: 'Sağlık' },
  { name: 'Baby',            label: 'Bebek',        group: 'Sağlık' },
  { name: 'Brain',           label: 'Psikoloji',    group: 'Sağlık' },
  { name: 'Stethoscope',     label: 'Doktor',       group: 'Sağlık' },

  { name: 'Music',           label: 'Müzik',        group: 'Eğlence' },
  { name: 'Gamepad2',        label: 'Oyun',         group: 'Eğlence' },
  { name: 'Film',            label: 'Sinema',       group: 'Eğlence' },
  { name: 'BookOpen',        label: 'Kitap',        group: 'Eğlence' },
  { name: 'Ticket',          label: 'Etkinlik',     group: 'Eğlence' },
  { name: 'Headphones',      label: 'Podcast',      group: 'Eğlence' },
  { name: 'Camera',          label: 'Fotoğraf',     group: 'Eğlence' },

  { name: 'Globe',           label: 'Seyahat',      group: 'Diğer' },
  { name: 'Shield',          label: 'Sigorta',      group: 'Diğer' },
  { name: 'Scale',           label: 'Hukuk',        group: 'Diğer' },
  { name: 'Briefcase',       label: 'İş',           group: 'Diğer' },
  { name: 'GraduationCap',   label: 'Eğitim',       group: 'Diğer' },
  { name: 'Gift',            label: 'Hediye',       group: 'Diğer' },
  { name: 'Star',            label: 'Favori',       group: 'Diğer' },
  { name: 'Sun',             label: 'Tatil',        group: 'Diğer' },
  { name: 'Leaf',            label: 'Doğa',         group: 'Diğer' },
  { name: 'Cigarette',       label: 'Tütün',        group: 'Diğer' },
  { name: 'Sparkles',        label: 'Kişisel Bakım', group: 'Diğer' },
  { name: 'RefreshCw',       label: 'Abonelik',     group: 'Diğer' },
  { name: 'Monitor',         label: 'Yazılım/Tech', group: 'Diğer' },
  { name: 'Pencil',          label: 'Kırtasiye',    group: 'Diğer' },
]

/* ── CategoryIcon component ───────────────────────────────────────── */
interface CategoryIconProps {
  icon: string
  color: string
  size?: number
  className?: string
}

export function CategoryIcon({ icon, color, size = 16, className = '' }: CategoryIconProps) {
  const LIcon = ICON_MAP[icon]
  const containerSize = size + 10  // icon + padding

  if (LIcon) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl flex-shrink-0 ${className}`}
        style={{
          width:  containerSize,
          height: containerSize,
          background: color,
        }}
      >
        <LIcon size={size} color="white" strokeWidth={1.75} />
      </div>
    )
  }

  // Emoji / legacy fallback
  return (
    <div
      className={`flex items-center justify-center rounded-xl flex-shrink-0 ${className}`}
      style={{
        width:  containerSize,
        height: containerSize,
        background: `${color}22`,
        fontSize: size * 0.75,
      }}
    >
      {icon}
    </div>
  )
}

/* ── Label helper for dropdowns ───────────────────────────────────── */
export function formatCategoryLabel(cat: { icon: string; name: string }): string {
  return ICON_MAP[cat.icon] ? cat.name : `${cat.icon} ${cat.name}`
}
