'use client'

import { useState } from 'react'

const BRANDS: { pattern: RegExp; domain: string }[] = [
  { pattern: /migros/i,                            domain: 'migros.com.tr' },
  { pattern: /\bbim\b/i,                           domain: 'bim.com.tr' },
  { pattern: /a\s*101/i,                           domain: 'a101.com.tr' },
  { pattern: /şok|sok\s*market/i,                  domain: 'sokmarket.com.tr' },
  { pattern: /carrefour/i,                         domain: 'carrefoursa.com.tr' },
  { pattern: /amazon/i,                            domain: 'amazon.com.tr' },
  { pattern: /trendyol/i,                          domain: 'trendyol.com' },
  { pattern: /hepsiburada/i,                       domain: 'hepsiburada.com' },
  { pattern: /n11/i,                               domain: 'n11.com' },
  { pattern: /sahibinden/i,                        domain: 'sahibinden.com' },
  { pattern: /getir/i,                             domain: 'getir.com' },
  { pattern: /yemeksepeti/i,                       domain: 'yemeksepeti.com' },
  { pattern: /uber\s*eats|ubereats/i,              domain: 'ubereats.com' },
  { pattern: /uber/i,                              domain: 'uber.com' },
  { pattern: /netflix/i,                           domain: 'netflix.com' },
  { pattern: /spotify/i,                           domain: 'spotify.com' },
  { pattern: /apple/i,                             domain: 'apple.com' },
  { pattern: /google/i,                            domain: 'google.com' },
  { pattern: /youtube/i,                           domain: 'youtube.com' },
  { pattern: /ikea/i,                              domain: 'ikea.com.tr' },
  { pattern: /media\s*markt/i,                     domain: 'mediamarkt.com.tr' },
  { pattern: /teknosa/i,                           domain: 'teknosa.com' },
  { pattern: /vatan\s*bilgisayar|vatanbilgisayar/i, domain: 'vatanbilgisayar.com' },
  { pattern: /lc\s*waikiki|\blcw\b/i,              domain: 'lcwaikiki.com' },
  { pattern: /zara/i,                              domain: 'zara.com' },
  { pattern: /h\s*&\s*m|\bhm\b/i,                  domain: 'hm.com' },
  { pattern: /primark/i,                           domain: 'primark.com' },
  { pattern: /mango/i,                             domain: 'mango.com' },
  { pattern: /starbucks/i,                         domain: 'starbucks.com.tr' },
  { pattern: /mcdonald|mc\s*donald/i,              domain: 'mcdonalds.com.tr' },
  { pattern: /burger\s*king/i,                     domain: 'burgerking.com.tr' },
  { pattern: /\bkfc\b/i,                           domain: 'kfc.com.tr' },
  { pattern: /domino/i,                            domain: 'dominos.com.tr' },
  { pattern: /little\s*caesars/i,                  domain: 'littlecaesars.com.tr' },
  { pattern: /turkcell/i,                          domain: 'turkcell.com.tr' },
  { pattern: /vodafone/i,                          domain: 'vodafone.com.tr' },
  { pattern: /türk\s*telekom|turk\s*telekom/i,     domain: 'turktelekom.com.tr' },
  { pattern: /decathlon/i,                         domain: 'decathlon.com.tr' },
  { pattern: /paypal/i,                            domain: 'paypal.com' },
  { pattern: /steam/i,                             domain: 'store.steampowered.com' },
  { pattern: /playstation|ps\s*store/i,            domain: 'playstation.com' },
  { pattern: /microsoft/i,                         domain: 'microsoft.com' },
  { pattern: /airbnb/i,                            domain: 'airbnb.com' },
  { pattern: /booking\.com|booking/i,              domain: 'booking.com' },
  { pattern: /enuygun/i,                           domain: 'enuygun.com' },
  { pattern: /biletix/i,                           domain: 'biletix.com' },
  { pattern: /pegasus/i,                           domain: 'flypgs.com' },
  { pattern: /turkish\s*airlines|thy/i,            domain: 'turkishairlines.com' },
  { pattern: /anadolu\s*jet/i,                     domain: 'anadolujet.com' },
  { pattern: /iett|metro istanbul/i,               domain: 'iett.istanbul' },
  { pattern: /musto|mosto/i,                       domain: 'mustafa.com.tr' },
  { pattern: /koton/i,                             domain: 'koton.com' },
  { pattern: /defacto/i,                           domain: 'defacto.com.tr' },
  { pattern: /english\s*home/i,                    domain: 'theenglishhome.co.uk' },
  { pattern: /kigili/i,                            domain: 'kigili.com' },
  { pattern: /boyner/i,                            domain: 'boyner.com.tr' },
  { pattern: /twitch/i,                            domain: 'twitch.tv' },
  { pattern: /discord/i,                           domain: 'discord.com' },
  { pattern: /chatgpt|openai/i,                    domain: 'openai.com' },
  { pattern: /claude|anthropic/i,                  domain: 'anthropic.com' },
  { pattern: /canva/i,                             domain: 'canva.com' },
  { pattern: /dropbox/i,                           domain: 'dropbox.com' },
  { pattern: /notion/i,                            domain: 'notion.so' },
  { pattern: /1password/i,                         domain: '1password.com' },
]

const FAMILY_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B',
  '#3B82F6', '#10B981', '#F97316', '#EF4444', '#06B6D4',
]

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function getBrandDomain(name: string): string | null {
  for (const b of BRANDS) if (b.pattern.test(name)) return b.domain
  return null
}

const SIZES = {
  xs: { box: 'w-5 h-5',  text: 'text-[8px]',  pad: 'p-[3px]' },
  sm: { box: 'w-7 h-7',  text: 'text-[10px]', pad: 'p-1' },
  md: { box: 'w-9 h-9',  text: 'text-xs',     pad: 'p-1.5' },
}

function extractDomain(url: string): string | null {
  try {
    const href = url.startsWith('http') ? url : `https://${url}`
    return new URL(href).hostname
  } catch {
    return null
  }
}

interface Props {
  person: { name: string; role: 'family_member' | 'recipient'; url?: string }
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

export function PersonAvatar({ person, size = 'sm', className = '' }: Props) {
  const s = SIZES[size]
  const initial = person.name.trim()[0]?.toUpperCase() ?? '?'

  if (person.role === 'family_member') {
    const color = FAMILY_COLORS[hashName(person.name) % FAMILY_COLORS.length]
    return (
      <div
        className={`${s.box} flex-shrink-0 rounded-full flex items-center justify-center ${s.text} font-bold text-white select-none ${className}`}
        style={{ background: color }}
      >
        {initial}
      </div>
    )
  }

  return <RecipientAvatar name={person.name} url={person.url} s={s} className={className} initial={initial} />
}

function RecipientAvatar({
  name, url, s, className, initial,
}: {
  name: string
  url?: string
  s: typeof SIZES['sm']
  className: string
  initial: string
}) {
  const [failed, setFailed] = useState(false)

  // Priority: explicit URL domain > brand pattern match > sanitised-name guess
  const urlDomain   = url ? extractDomain(url) : null
  const knownDomain = getBrandDomain(name)
  const guessDomain = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com.tr'
  const domain = urlDomain ?? knownDomain ?? guessDomain

  if (!failed) {
    return (
      <div
        className={`${s.box} flex-shrink-0 rounded-md overflow-hidden bg-card border border-border flex items-center justify-center ${s.pad} ${className}`}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={name}
          className="max-w-full max-h-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`${s.box} flex-shrink-0 rounded-md flex items-center justify-center ${s.text} font-bold text-white select-none ${className}`}
      style={{ background: '#00E5FF' }}
    >
      {initial}
    </div>
  )
}
