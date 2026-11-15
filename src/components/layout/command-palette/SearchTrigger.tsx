'use client'

import { useSyncExternalStore } from 'react'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { openCommandPalette, shortcutLabel } from './useCommandPalette'

const noopSubscribe = () => () => {}

/** Kenar çubuğundaki arama girişi — tıklayınca komut paletini açar. */
export function SearchTrigger() {
  // Kısayol ipucu platforma bağlı; sunucuda/ilk karede "Ctrl K" (hidrasyon uyumu).
  const hint = useSyncExternalStore(noopSubscribe, shortcutLabel, () => 'Ctrl K')
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts="Control+K Meta+K"
      className={[
        'w-full flex items-center gap-2 border border-border bg-secondary/40 text-muted-foreground',
        'hover:text-foreground hover:bg-secondary/70 transition-colors text-left',
        'h-9 px-2.5 rounded-lg text-[13px]',
      ].join(' ')}
    >
      <Icon d={IC.search} size={15} />
      <span className="flex-1">Ara…</span>
      <kbd className="font-sans text-[10px] font-semibold border border-border rounded px-1 py-px">{hint}</kbd>
    </button>
  )
}
