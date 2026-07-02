'use client'

import { useState, useEffect } from 'react'
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

/* ── Static Tabler map (pre-loaded, zero layout shift) ───────────── */
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
  'settings':            IconSettings,
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

/* ── Color palette ────────────────────────────────────────────────── */
export const COLOR_PALETTE = [
  '#6366F1', '#3B82F6', '#0EA5E9', '#06B6D4',
  '#10B981', '#84CC16', '#EAB308', '#F97316',
  '#EF4444', '#EC4899', '#A855F7', '#8B5CF6',
  '#6B8F80', '#78716C', '#0F766E', '#1D4ED8',
]

export const DEFAULT_ICON  = 'package'
export const DEFAULT_COLOR = '#6366F1'

/* ── Dynamic fallback for icons not in the static map ───────────── */
let allTablerIcons: Record<string, TablerIcon> | null = null
let loadPromise: Promise<void> | null = null

function ensureAllTablerIcons(): Promise<void> {
  if (!loadPromise) {
    loadPromise = import('@tabler/icons-react')
      .then(mod => { allTablerIcons = mod as unknown as Record<string, TablerIcon> })
      .catch(() => { loadPromise = null })
  }
  return loadPromise
}

export function tablerComponentName(kebab: string): string {
  return 'Icon' + kebab.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

export function resolveTablerIcon(name: string): TablerIcon | null {
  if (TABLER_MAP[name]) return TABLER_MAP[name]
  if (allTablerIcons) return (allTablerIcons[tablerComponentName(name)] as TablerIcon) || null
  return null
}

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

  // Check static map first (zero flash)
  const staticTabler = TABLER_MAP[icon]

  // State for dynamically loaded icons not in the static map
  const [dynamicIcon, setDynamicIcon] = useState<TablerIcon | null>(() => staticTabler || null)

  useEffect(() => {
    if (icon in TABLER_MAP || icon.includes(':') || icon in ICON_MAP) return
    // Try from already-loaded cache
    const cached = resolveTablerIcon(icon)
    if (cached) { setDynamicIcon(cached); return }
    // Lazy load full Tabler module (cached at module level after first call)
    ensureAllTablerIcons().then(() => {
      const ic = resolveTablerIcon(icon)
      if (ic) setDynamicIcon(ic)
    })
  }, [icon, staticTabler])

  const TIcon = dynamicIcon

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

  // Legacy Iconify icon (noto:*, etc.)
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

  // Placeholder while dynamic icon is loading, or emoji fallback
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: containerSize, height: containerSize, borderRadius: radius, background: `${color}22`, fontSize: size * 0.8 }}
    >
      {icon.length <= 2 ? (icon || '📦') : null}
    </span>
  )
}

/* ── Label helper ─────────────────────────────────────────────────── */
export function formatCategoryLabel(cat: { icon: string; name: string }): string {
  const hasIcon = cat.icon in ICON_MAP || cat.icon.includes(':') || cat.icon in TABLER_MAP
  return hasIcon ? cat.name : `${cat.icon} ${cat.name}`
}
