'use client'

import { usePrivacyStore } from '@/store/privacy.store'

/* Banka markaları: alan adı favicon için, renk çevrimdışı rozet için (çevrimiçi
   logolar gizlilik ayarıyla kapalıyken de banka tanınır kalsın). */
const BANKS: { pattern: RegExp; domain: string; color: string }[] = [
  { pattern: /garanti|bbva/i,                        domain: 'garantibbva.com.tr',  color: '#00A19B' },
  { pattern: /iş bank|işbank|isbank/i,               domain: 'isbank.com.tr',       color: '#0D4E96' },
  { pattern: /yapı kredi|yapikredi|\bykb\b/i,        domain: 'yapikredi.com.tr',    color: '#0B3C7E' },
  { pattern: /ziraat/i,                              domain: 'ziraatbank.com.tr',   color: '#C8102E' },
  { pattern: /vakıf|vakif/i,                         domain: 'vakifbank.com.tr',    color: '#E8A200' },
  { pattern: /halkbank|halk bank/i,                  domain: 'halkbank.com.tr',     color: '#005BAA' },
  { pattern: /akbank/i,                              domain: 'akbank.com',          color: '#E2001A' },
  { pattern: /finansbank|qnb/i,                      domain: 'finansbank.com.tr',   color: '#7F2653' },
  { pattern: /enpara/i,                              domain: 'enpara.com',          color: '#8E2B8C' },
  { pattern: /\bteb\b|türk ekonomi/i,                domain: 'teb.com.tr',          color: '#00874A' },
  { pattern: /denizbank/i,                           domain: 'denizbank.com',       color: '#005EB8' },
  { pattern: /\bing\b/i,                             domain: 'ingbank.com.tr',      color: '#FF6200' },
  { pattern: /\bhsbc\b/i,                            domain: 'hsbc.com.tr',         color: '#DB0011' },
  { pattern: /fibabanka|fiba bank/i,                 domain: 'fibabanka.com',       color: '#005A9C' },
  { pattern: /kuveyt türk|kuveyt turk|kuveytturk/i,  domain: 'kuveytturk.com.tr',   color: '#0B7C3F' },
  { pattern: /albaraka/i,                            domain: 'albaraka.com.tr',     color: '#00573F' },
  { pattern: /türkiye finans|turkiye finans/i,        domain: 'turkiyefinans.com.tr', color: '#0C8A4A' },
  { pattern: /şekerbank|sekerbank/i,                 domain: 'sekerbank.com.tr',    color: '#009640' },
  { pattern: /odeabank|\bodea bank/i,                domain: 'odeabank.com',        color: '#E30613' },
  { pattern: /burgan/i,                              domain: 'burgan.com.tr',       color: '#00707F' },
  { pattern: /papara/i,                              domain: 'papara.com',          color: '#662D91' },
  { pattern: /nkolay/i,                              domain: 'nkolay.com',          color: '#F15A29' },
]

/** Banka adından marka (favicon alanı + çevrimdışı rozet rengi); tanınmazsa null */
export function getBankBrand(name: string): { domain: string; color: string } | null {
  for (const b of BANKS) if (b.pattern.test(name)) return { domain: b.domain, color: b.color }
  return null
}

export function getBankDomain(name: string): string | null {
  return getBankBrand(name)?.domain ?? null
}

const SIZES = {
  xs: { box: 'w-5 h-5',    text: 'text-[8px]',  pad: 'p-[3px]' },
  sm: { box: 'w-8 h-8',    text: 'text-[10px]', pad: 'p-1.5' },
  md: { box: 'w-10 h-10',  text: 'text-xs',     pad: 'p-1.5' },
  lg: { box: 'w-14 h-14',  text: 'text-base',   pad: 'p-2.5' },
}

interface Props {
  account: { name: string; color: string; icon?: string }
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

export function AccountAvatar({ account, size = 'md', className = '' }: Props) {
  const s       = SIZES[size]
  const initial = account.name.trim()[0]?.toUpperCase() ?? '?'

  // Gizlilik tercihi kapalıyken dış adres yüklenmez: yalnız cihazda gömülü
  // (data:) ikon kalır; banka favicon'u ve kullanıcının girdiği URL atlanır.
  const onlineLogos = usePrivacyStore(s => s.onlineLogos)
  const ownIcon = account.icon && (onlineLogos || account.icon.startsWith('data:')) ? account.icon : null
  const bankDomain = onlineLogos ? getBankDomain(account.name) : null
  const iconSrc = ownIcon
    ?? (bankDomain ? `https://www.google.com/s2/favicons?domain=${bankDomain}&sz=64` : null)

  return (
    <div className={`${s.box} flex-shrink-0 relative overflow-hidden rounded-md ${className}`}>
      {/* Base: colored initial — always visible, serves as fallback */}
      <div
        className={`absolute inset-0 flex items-center justify-center ${s.text} font-bold text-white`}
        style={{ background: account.color }}
      >
        {initial}
      </div>

      {/* Overlay: transparent until image loads, so initial shows immediately */}
      {iconSrc && (
        <div className={`absolute inset-0 bg-card flex items-center justify-center ${s.pad} opacity-0`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- dış/kullanıcı kaynaklı küçük ikon (data: URL ya da favicon); next/image optimizasyonu bu kaynaklara uygulanamaz */}
          <img
            src={iconSrc}
            alt={account.name}
            className="max-w-full max-h-full object-contain"
            onLoad={e => {
              const overlay = e.currentTarget.parentElement
              if (overlay) overlay.style.opacity = '1'
            }}
            onError={e => {
              const overlay = e.currentTarget.parentElement
              if (overlay) overlay.style.display = 'none'
            }}
          />
        </div>
      )}
    </div>
  )
}
