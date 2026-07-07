'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { tagColor, tagKey } from '@/lib/utils/tags'

interface Props {
  tags?: string[]
  className?: string
}

/**
 * Inline, minimalist clickable tag badges for transaction rows. Each badge
 * links to its /tags/[tag] detail page and stops propagation so it never
 * triggers the row's edit action. Renders nothing when there are no tags, so
 * untagged rows reserve no space.
 */
export function TagBadges({ tags, className }: Props) {
  if (!tags?.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1 min-w-0', className)}>
      {tags.map(tag => {
        const key   = tagKey(tag)
        const color = tagColor(key)
        return (
          <Link
            key={key}
            href={`/tags/${encodeURIComponent(tag)}`}
            onClick={e => e.stopPropagation()}
            title={`#${tag}`}
            className="inline-flex max-w-[9rem] items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none transition-opacity hover:opacity-80"
            style={{ background: `${color}1A`, color }}
          >
            <span className="opacity-60">#</span>
            <span className="truncate">{tag}</span>
          </Link>
        )
      })}
    </div>
  )
}
