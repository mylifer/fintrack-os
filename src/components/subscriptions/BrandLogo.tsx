'use client'

import type { Brand } from '@/lib/subscriptions/brands'

/* Presentational brand logo.
   - If the brand carries embedded SVG path data → render the exact logo inside
     a rounded container tinted with the brand color (~12% opacity).
   - Otherwise → a neutral monogram circle (first letter of the name).
   Fully self-contained and theme-aware (monogram bg uses --muted tokens). */

interface BrandLogoProps {
  brand: Brand | null
  name: string
  size?: number
}

export function BrandLogo({ brand, name, size = 40 }: BrandLogoProps) {
  const box = { width: size, height: size }

  if (brand?.path) {
    const icon = Math.round(size * 0.56)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-xl"
        style={{ ...box, backgroundColor: hexToRgba(brand.color, 0.12) }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" width={icon} height={icon} role="img" aria-label={brand.name}>
          <path d={brand.path} fill={brand.color} />
        </svg>
      </span>
    )
  }

  const letter = (name.trim()[0] ?? '?').toLocaleUpperCase('tr-TR')
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground font-semibold"
      style={{ ...box, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

/** '#RRGGBB' + alpha → rgba() string. Falls back to a neutral tint on bad input. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(120,120,120,${alpha})`
  const int = parseInt(m[1], 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r},${g},${b},${alpha})`
}
