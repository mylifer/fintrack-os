'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import * as TablerIcons from '@tabler/icons-react'
import { TABLER_ICON_NAMES } from '@/lib/tabler-icon-names'
import { tablerComponentName, COLOR_PALETTE, DEFAULT_ICON, DEFAULT_COLOR, TABLER_MAP } from './CategoryIcon'
import type { TablerIcon } from '@tabler/icons-react'

interface Props {
  icon: string
  color: string
  onChange: (icon: string, color: string) => void
}

/* ── Curated groups shown when not searching ─────────────────────── */
const CURATED: { group: string; icons: string[] }[] = [
  { group: 'Finans',      icons: ['wallet','credit-card','cash','pig-money','coin','moneybag','receipt','trending-up','building-bank','briefcase','gift','heart-handshake','scale','chart-bar','package'] },
  { group: 'Yemek',       icons: ['tools-kitchen-2','shopping-cart','coffee','beer','pizza','salad','meat','fish','bottle'] },
  { group: 'Ulaşım',      icons: ['car','bus','train','plane','bike','motorbike','gas-station','parking','road','sailboat'] },
  { group: 'Ev',          icons: ['home','key','hammer','tool','settings','bolt','droplet','flame','wifi','phone','device-tv','sofa','building','shield','spray'] },
  { group: 'Sağlık',      icons: ['building-hospital','stethoscope','pill','brain','dental','baby-carriage','barbell','run','heart','activity'] },
  { group: 'Eğlence',     icons: ['device-gamepad-2','music','movie','book','ticket','headphones','camera','confetti','sun'] },
  { group: 'Alışveriş',   icons: ['shopping-bag','hanger','device-laptop','device-desktop','pencil','sparkles','smoking','diamond','backpack'] },
  { group: 'Diğer',       icons: ['school','star','leaf','tree','refresh','phone-call','wand','fish'] },
]

/* ── Convert kebab name to readable label ────────────────────────── */
function toLabel(name: string): string {
  return name.replace(/-/g, ' ')
}

/* ── Get icon component from TablerIcons module ──────────────────── */
function getIcon(name: string): TablerIcon | null {
  const cn = tablerComponentName(name)
  const ic = (TablerIcons as unknown as Record<string, unknown>)[cn]
  return typeof ic === 'function' ? (ic as TablerIcon) : null
}

const MAX_SEARCH_RESULTS = 300

export function CategoryIconPicker({ icon, color, onChange }: Props) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const currentIcon  = icon  || DEFAULT_ICON
  const currentColor = color || DEFAULT_COLOR

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  /* Search across all 6146 icon names */
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return TABLER_ICON_NAMES.filter(n => n.includes(q) || toLabel(n).includes(q)).slice(0, MAX_SEARCH_RESULTS)
  }, [search])

  const TriggerIcon = TABLER_MAP[currentIcon] || getIcon(currentIcon)

  function selectIcon(name: string) {
    onChange(name, currentColor)
    setSearch('')
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-10 h-10 rounded-xl border-2 border-border hover:border-primary transition-colors flex items-center justify-center overflow-hidden"
        style={{ background: currentColor }}
        title="İkon ve renk seç"
      >
        {TriggerIcon
          ? <TriggerIcon size={20} style={{ color: 'white' }} stroke={1.75} />
          : <span className="text-white text-xs font-bold">?</span>
        }
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[360px] rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-border flex-shrink-0">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="6000+ ikon ara… (ör: car, home, food)"
              autoFocus
              className="w-full text-xs px-3 h-8 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Color palette */}
          <div className="px-3 pt-2.5 pb-2 border-b border-border flex-shrink-0">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Renk</div>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange(currentIcon, c)}
                  title={c}
                  className="w-6 h-6 rounded-lg transition-all hover:scale-110 flex-shrink-0"
                  style={{
                    background: c,
                    outline: currentColor === c ? '2px solid white' : 'none',
                    boxShadow: currentColor === c ? `0 0 0 3px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Icon grid */}
          <div className="overflow-y-auto flex-1" style={{ maxHeight: 300 }}>
            {search.trim() ? (
              <div className="p-2">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">Sonuç bulunamadı</p>
                ) : (
                  <>
                    {searchResults.length >= MAX_SEARCH_RESULTS && (
                      <p className="text-[10px] text-muted-foreground px-1 mb-2">
                        İlk {MAX_SEARCH_RESULTS} sonuç gösteriliyor — aramayı daraltın
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {searchResults.map(name => (
                        <IconButton
                          key={name}
                          name={name}
                          selected={currentIcon === name}
                          color={currentColor}
                          onSelect={selectIcon}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-2">
                {CURATED.map(group => (
                  <div key={group.group} className="mb-3">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">{group.group}</div>
                    <div className="flex flex-wrap gap-1">
                      {group.icons.map(name => (
                        <IconButton
                          key={name}
                          name={name}
                          selected={currentIcon === name}
                          color={currentColor}
                          onSelect={selectIcon}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Single icon button ───────────────────────────────────────────── */
function IconButton({
  name, selected, color, onSelect,
}: {
  name: string
  selected: boolean
  color: string
  onSelect: (name: string) => void
}) {
  const TIcon = getIcon(name)
  if (!TIcon) return null

  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      title={toLabel(name)}
      className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
      style={selected ? {
        background: color,
        transform: 'scale(1.1)',
        outline: `2px solid ${color}`,
        outlineOffset: 2,
      } : undefined}
    >
      {selected
        ? <TIcon size={18} style={{ color: 'white' }} stroke={1.75} />
        : (
          <span className="w-9 h-9 rounded-xl flex items-center justify-center hover:scale-110 transition-transform bg-muted/40 hover:bg-muted/70">
            <TIcon size={18} className="text-foreground/70" stroke={1.75} />
          </span>
        )
      }
    </button>
  )
}
