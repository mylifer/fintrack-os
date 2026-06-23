const BANKS: { pattern: RegExp; domain: string }[] = [
  { pattern: /garanti|bbva/i,                        domain: 'garantibbva.com.tr' },
  { pattern: /iş bank|işbank|isbank/i,               domain: 'isbank.com.tr' },
  { pattern: /yapı kredi|yapikredi|\bykb\b/i,         domain: 'yapikredi.com.tr' },
  { pattern: /ziraat/i,                              domain: 'ziraatbank.com.tr' },
  { pattern: /vakıf|vakif/i,                         domain: 'vakifbank.com.tr' },
  { pattern: /halkbank|halk bank/i,                  domain: 'halkbank.com.tr' },
  { pattern: /akbank/i,                              domain: 'akbank.com' },
  { pattern: /finansbank|qnb/i,                      domain: 'finansbank.com.tr' },
  { pattern: /enpara/i,                              domain: 'enpara.com' },
  { pattern: /\bteb\b|türk ekonomi/i,                domain: 'teb.com.tr' },
  { pattern: /denizbank/i,                           domain: 'denizbank.com' },
  { pattern: /\bing\b/i,                             domain: 'ingbank.com.tr' },
  { pattern: /\bhsbc\b/i,                            domain: 'hsbc.com.tr' },
  { pattern: /fibabanka|fiba bank/i,                 domain: 'fibabanka.com' },
  { pattern: /kuveyt türk|kuveyt turk|kuveytturk/i,  domain: 'kuveytturk.com.tr' },
  { pattern: /albaraka/i,                            domain: 'albaraka.com.tr' },
  { pattern: /türkiye finans|turkiye finans/i,        domain: 'turkiyefinans.com.tr' },
  { pattern: /şekerbank|sekerbank/i,                 domain: 'sekerbank.com.tr' },
  { pattern: /odeabank|\bodea bank/i,                domain: 'odeabank.com' },
  { pattern: /burgan/i,                              domain: 'burgan.com.tr' },
  { pattern: /papara/i,                              domain: 'papara.com' },
  { pattern: /nkolay/i,                              domain: 'nkolay.com' },
]

function getBankDomain(name: string): string | null {
  for (const b of BANKS) if (b.pattern.test(name)) return b.domain
  return null
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

  // Resolve icon source: custom icon takes priority over bank detection
  const iconSrc = account.icon
    ?? (getBankDomain(account.name)
        ? `https://www.google.com/s2/favicons?domain=${getBankDomain(account.name)}&sz=64`
        : null)

  return (
    <div className={`${s.box} flex-shrink-0 relative overflow-hidden rounded-md ${className}`}>
      {/* Base: colored initial — always rendered, serves as fallback */}
      <div
        className={`absolute inset-0 flex items-center justify-center ${s.text} font-bold text-white`}
        style={{ background: account.color }}
      >
        {initial}
      </div>

      {/* Overlay: icon with white card — hidden via onError if load fails */}
      {iconSrc && (
        <div className={`absolute inset-0 bg-card flex items-center justify-center ${s.pad}`}>
          <img
            src={iconSrc}
            alt={account.name}
            className="max-w-full max-h-full object-contain"
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
