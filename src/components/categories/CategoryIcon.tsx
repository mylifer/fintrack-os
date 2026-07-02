'use client'

import { Icon } from '@iconify/react'
import {
  IconWallet, IconCreditCard, IconCash, IconTrendingUp, IconBuildingBank,
  IconBriefcase, IconGift, IconReceipt, IconCoin, IconScale, IconPackage,
  IconPigMoney, IconHeartHandshake, IconArrowUpRight, IconArrowDownLeft,
  IconChartBar, IconMoneybag,
  IconShoppingCart, IconToolsKitchen2, IconCoffee, IconBeer, IconPizza,
  IconSalad, IconBottle, IconMeat,
  IconCar, IconBus, IconTrain, IconPlane, IconBike, IconGasStation, IconParking,
  IconMotorbike, IconSailboat, IconRoad,
  IconHome, IconKey, IconHammer, IconTool, IconBolt, IconDroplet, IconFlame,
  IconWifi, IconPhone, IconDeviceTv, IconSofa, IconBuilding, IconShield,
  IconSpray, IconSettings,
  IconBuildingHospital, IconStethoscope, IconPill, IconBrain, IconHeart,
  IconActivity, IconBarbell, IconBabyCarriage, IconDental, IconRun,
  IconDeviceGamepad2, IconMusic, IconMovie, IconBook, IconTicket,
  IconHeadphones, IconCamera, IconSun, IconConfetti,
  IconShoppingBag, IconDeviceLaptop, IconDeviceDesktop, IconPencil,
  IconSmoking, IconBackpack, IconHanger, IconDiamond,
  IconSchool, IconStar, IconLeaf, IconRefresh, IconPhoneCall,
  IconSparkles, IconWand, IconFish, IconTree,
  type TablerIcon,
} from '@tabler/icons-react'
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

/* ── Tabler icon map ──────────────────────────────────────────────── */
export const TABLER_MAP: Record<string, TablerIcon> = {
  'wallet':              IconWallet,
  'credit-card':         IconCreditCard,
  'cash':                IconCash,
  'trending-up':         IconTrendingUp,
  'building-bank':       IconBuildingBank,
  'briefcase':           IconBriefcase,
  'gift':                IconGift,
  'receipt':             IconReceipt,
  'coin':                IconCoin,
  'scale':               IconScale,
  'package':             IconPackage,
  'pig-money':           IconPigMoney,
  'heart-handshake':     IconHeartHandshake,
  'arrow-up-right':      IconArrowUpRight,
  'arrow-down-left':     IconArrowDownLeft,
  'chart-bar':           IconChartBar,
  'moneybag':            IconMoneybag,
  'shopping-cart':       IconShoppingCart,
  'tools-kitchen-2':     IconToolsKitchen2,
  'coffee':              IconCoffee,
  'beer':                IconBeer,
  'pizza':               IconPizza,
  'salad':               IconSalad,
  'bottle':              IconBottle,
  'meat':                IconMeat,
  'car':                 IconCar,
  'bus':                 IconBus,
  'train':               IconTrain,
  'plane':               IconPlane,
  'bike':                IconBike,
  'gas-station':         IconGasStation,
  'parking':             IconParking,
  'motorbike':           IconMotorbike,
  'sailboat':            IconSailboat,
  'road':                IconRoad,
  'home':                IconHome,
  'key':                 IconKey,
  'hammer':              IconHammer,
  'tool':                IconTool,
  'bolt':                IconBolt,
  'droplet':             IconDroplet,
  'flame':               IconFlame,
  'wifi':                IconWifi,
  'phone':               IconPhone,
  'device-tv':           IconDeviceTv,
  'sofa':                IconSofa,
  'building':            IconBuilding,
  'shield':              IconShield,
  'spray':               IconSpray,
  'wrench':              IconSettings,
  'building-hospital':   IconBuildingHospital,
  'stethoscope':         IconStethoscope,
  'pill':                IconPill,
  'brain':               IconBrain,
  'heart':               IconHeart,
  'activity':            IconActivity,
  'barbell':             IconBarbell,
  'baby-carriage':       IconBabyCarriage,
  'dental':              IconDental,
  'run':                 IconRun,
  'device-gamepad-2':    IconDeviceGamepad2,
  'music':               IconMusic,
  'movie':               IconMovie,
  'book':                IconBook,
  'ticket':              IconTicket,
  'headphones':          IconHeadphones,
  'camera':              IconCamera,
  'sun':                 IconSun,
  'confetti':            IconConfetti,
  'shopping-bag':        IconShoppingBag,
  'device-laptop':       IconDeviceLaptop,
  'device-desktop':      IconDeviceDesktop,
  'pencil':              IconPencil,
  'smoking':             IconSmoking,
  'backpack':            IconBackpack,
  'hanger':              IconHanger,
  'diamond':             IconDiamond,
  'school':              IconSchool,
  'star':                IconStar,
  'leaf':                IconLeaf,
  'refresh':             IconRefresh,
  'phone-call':          IconPhoneCall,
  'sparkles':            IconSparkles,
  'wand':                IconWand,
  'fish':                IconFish,
  'tree':                IconTree,
}

/* ── Tabler icon list for the picker ────────────────────────────── */
export const TABLER_ICON_LIST: { name: string; label: string; group: string }[] = [
  // Finans
  { name: 'wallet',           label: 'Cüzdan',       group: 'Finans' },
  { name: 'credit-card',      label: 'Kart',          group: 'Finans' },
  { name: 'cash',             label: 'Nakit',         group: 'Finans' },
  { name: 'pig-money',        label: 'Birikim',       group: 'Finans' },
  { name: 'coin',             label: 'Para',          group: 'Finans' },
  { name: 'moneybag',         label: 'Gelir',         group: 'Finans' },
  { name: 'receipt',          label: 'Fiş',           group: 'Finans' },
  { name: 'trending-up',      label: 'Yatırım',       group: 'Finans' },
  { name: 'building-bank',    label: 'Banka',         group: 'Finans' },
  { name: 'briefcase',        label: 'Maaş',          group: 'Finans' },
  { name: 'gift',             label: 'Hediye',        group: 'Finans' },
  { name: 'heart-handshake',  label: 'Bağış',         group: 'Finans' },
  { name: 'scale',            label: 'Hukuk',         group: 'Finans' },
  { name: 'chart-bar',        label: 'İstatistik',    group: 'Finans' },
  { name: 'package',          label: 'Diğer',         group: 'Finans' },

  // Yemek
  { name: 'tools-kitchen-2',  label: 'Restoran',      group: 'Yemek' },
  { name: 'shopping-cart',    label: 'Market',        group: 'Yemek' },
  { name: 'coffee',           label: 'Kahve',         group: 'Yemek' },
  { name: 'beer',             label: 'İçki',          group: 'Yemek' },
  { name: 'pizza',            label: 'Pizza',         group: 'Yemek' },
  { name: 'salad',            label: 'Salata',        group: 'Yemek' },
  { name: 'meat',             label: 'Et',            group: 'Yemek' },
  { name: 'fish',             label: 'Balık',         group: 'Yemek' },
  { name: 'bottle',           label: 'İçecek',        group: 'Yemek' },

  // Ulaşım
  { name: 'car',              label: 'Araç',          group: 'Ulaşım' },
  { name: 'bus',              label: 'Otobüs',        group: 'Ulaşım' },
  { name: 'train',            label: 'Tren',          group: 'Ulaşım' },
  { name: 'plane',            label: 'Uçak',          group: 'Ulaşım' },
  { name: 'bike',             label: 'Bisiklet',      group: 'Ulaşım' },
  { name: 'motorbike',        label: 'Motosiklet',    group: 'Ulaşım' },
  { name: 'gas-station',      label: 'Yakıt',         group: 'Ulaşım' },
  { name: 'parking',          label: 'Otopark',       group: 'Ulaşım' },
  { name: 'road',             label: 'HGS',           group: 'Ulaşım' },
  { name: 'sailboat',         label: 'Gemi',          group: 'Ulaşım' },

  // Ev
  { name: 'home',             label: 'Ev',            group: 'Ev' },
  { name: 'key',              label: 'Kira',          group: 'Ev' },
  { name: 'hammer',           label: 'Tadilat',       group: 'Ev' },
  { name: 'tool',             label: 'Tamir',         group: 'Ev' },
  { name: 'wrench',           label: 'Çeşitli',       group: 'Ev' },
  { name: 'bolt',             label: 'Elektrik',      group: 'Ev' },
  { name: 'droplet',          label: 'Su',            group: 'Ev' },
  { name: 'flame',            label: 'Doğalgaz',      group: 'Ev' },
  { name: 'wifi',             label: 'İnternet',      group: 'Ev' },
  { name: 'phone',            label: 'Telefon',       group: 'Ev' },
  { name: 'device-tv',        label: 'TV',            group: 'Ev' },
  { name: 'sofa',             label: 'Mobilya',       group: 'Ev' },
  { name: 'building',         label: 'Aidat',         group: 'Ev' },
  { name: 'shield',           label: 'Sigorta',       group: 'Ev' },
  { name: 'spray',            label: 'Temizlik',      group: 'Ev' },

  // Sağlık
  { name: 'building-hospital',label: 'Hastane',       group: 'Sağlık' },
  { name: 'stethoscope',      label: 'Doktor',        group: 'Sağlık' },
  { name: 'pill',             label: 'İlaç',          group: 'Sağlık' },
  { name: 'brain',            label: 'Psikoloji',     group: 'Sağlık' },
  { name: 'dental',           label: 'Diş',           group: 'Sağlık' },
  { name: 'baby-carriage',    label: 'Bebek',         group: 'Sağlık' },
  { name: 'barbell',          label: 'Fitness',       group: 'Sağlık' },
  { name: 'run',              label: 'Spor',          group: 'Sağlık' },
  { name: 'heart',            label: 'Sağlık',        group: 'Sağlık' },

  // Eğlence
  { name: 'device-gamepad-2', label: 'Oyun',          group: 'Eğlence' },
  { name: 'music',            label: 'Müzik',         group: 'Eğlence' },
  { name: 'movie',            label: 'Sinema',        group: 'Eğlence' },
  { name: 'book',             label: 'Kitap',         group: 'Eğlence' },
  { name: 'ticket',           label: 'Etkinlik',      group: 'Eğlence' },
  { name: 'headphones',       label: 'Podcast',       group: 'Eğlence' },
  { name: 'camera',           label: 'Fotoğraf',      group: 'Eğlence' },
  { name: 'confetti',         label: 'Parti',         group: 'Eğlence' },
  { name: 'sun',              label: 'Tatil',         group: 'Eğlence' },

  // Alışveriş
  { name: 'shopping-bag',     label: 'Alışveriş',     group: 'Alışveriş' },
  { name: 'hanger',           label: 'Giyim',         group: 'Alışveriş' },
  { name: 'device-laptop',    label: 'Laptop',        group: 'Alışveriş' },
  { name: 'device-desktop',   label: 'Bilgisayar',    group: 'Alışveriş' },
  { name: 'pencil',           label: 'Kırtasiye',     group: 'Alışveriş' },
  { name: 'sparkles',         label: 'Kozmetik',      group: 'Alışveriş' },
  { name: 'smoking',          label: 'Tütün',         group: 'Alışveriş' },
  { name: 'diamond',          label: 'Aksesuar',      group: 'Alışveriş' },
  { name: 'backpack',         label: 'Çanta',         group: 'Alışveriş' },

  // Diğer
  { name: 'school',           label: 'Eğitim',        group: 'Diğer' },
  { name: 'star',             label: 'Favori',        group: 'Diğer' },
  { name: 'leaf',             label: 'Doğa',          group: 'Diğer' },
  { name: 'tree',             label: 'Orman',         group: 'Diğer' },
  { name: 'refresh',          label: 'Abonelik',      group: 'Diğer' },
  { name: 'phone-call',       label: 'Telefon',       group: 'Diğer' },
  { name: 'wand',             label: 'Diğer',         group: 'Diğer' },
]

/* ── Color palette ────────────────────────────────────────────────── */
export const COLOR_PALETTE = [
  '#6366F1', '#3B82F6', '#0EA5E9', '#06B6D4',
  '#10B981', '#84CC16', '#EAB308', '#F97316',
  '#EF4444', '#EC4899', '#A855F7', '#8B5CF6',
  '#6B8F80', '#78716C', '#0F766E', '#1D4ED8',
]

export const DEFAULT_ICON  = 'package'
export const DEFAULT_COLOR = '#6366F1'

/* ── CategoryIcon component ───────────────────────────────────────── */
interface CategoryIconProps {
  icon: string
  color?: string
  size?: number
  className?: string
}

export function CategoryIcon({ icon, color = DEFAULT_COLOR, size = 16, className = '' }: CategoryIconProps) {
  const containerSize = size + 10
  const radius = Math.round(containerSize * 0.28)

  // Tabler icon
  const TIcon = TABLER_MAP[icon]
  if (TIcon) {
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: containerSize, height: containerSize, borderRadius: radius, background: color }}
      >
        <TIcon size={size} style={{ color: 'white' }} stroke={1.75} />
      </span>
    )
  }

  // Legacy Iconify icon (noto:*, flat-color-icons:*, etc.)
  if (icon.includes(':')) {
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: containerSize, height: containerSize, borderRadius: radius, background: `${color}22` }}
      >
        <Icon icon={icon} width={size} height={size} />
      </span>
    )
  }

  // Legacy Lucide icon name
  const LIcon = ICON_MAP[icon]
  if (LIcon) {
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: containerSize, height: containerSize, borderRadius: radius, background: color }}
      >
        <LIcon size={size} color="white" strokeWidth={1.75} />
      </span>
    )
  }

  // Emoji / text fallback
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: containerSize, height: containerSize, borderRadius: radius, background: `${color}22`, fontSize: size * 0.8 }}
    >
      {icon || '📦'}
    </span>
  )
}

/* ── Label helper ─────────────────────────────────────────────────── */
export function formatCategoryLabel(cat: { icon: string; name: string }): string {
  return (ICON_MAP[cat.icon] || cat.icon.includes(':') || TABLER_MAP[cat.icon]) ? cat.name : `${cat.icon} ${cat.name}`
}
