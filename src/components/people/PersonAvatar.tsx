'use client'

import { useState } from 'react'

const FAMILY_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B',
  '#3B82F6', '#10B981', '#F97316', '#EF4444', '#06B6D4',
]

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

// "Ahmet" → "AH", "Kaan Baytur" → "KB", "" → "?"
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const raw = words.length === 1
    ? words[0].slice(0, 2)
    : words[0][0] + words[1][0]
  return raw.toLocaleUpperCase('tr-TR')
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
  const initials = getInitials(person.name)

  if (person.role === 'family_member') {
    const color = FAMILY_COLORS[hashName(person.name) % FAMILY_COLORS.length]
    return (
      <div
        className={`${s.box} flex-shrink-0 rounded-full flex items-center justify-center ${s.text} font-bold text-white select-none ${className}`}
        style={{ background: color }}
      >
        {initials}
      </div>
    )
  }

  return <RecipientAvatar name={person.name} url={person.url} s={s} className={className} initials={initials} />
}

function RecipientAvatar({
  name, url, s, className, initials,
}: {
  name: string
  url?: string
  s: typeof SIZES['sm']
  className: string
  initials: string
}) {
  const [failed, setFailed] = useState(false)

  // Only fetch a favicon when the user explicitly provided a valid URL.
  // Never guess a domain from the person's name (that leaked names to Google).
  const domain = url ? extractDomain(url) : null

  if (domain && !failed) {
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
      {initials}
    </div>
  )
}
