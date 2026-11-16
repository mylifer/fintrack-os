'use client'

import { useEffect, useState } from 'react'
import { Icon, IC } from '@/components/layout/sidebar/icons'

/* ── Ayarlar bölüm gezintisi ─────────────────────────────────────────────
   Ayarlar sayfası uzun; her kart bir `<section id>` içinde durur. Bu liste tek
   kaynak: sayfa bölümleri bu kimliklerle işaretler, kenar çubuğu (iki varyant
   da) /settings açıkken ana menünün yerine bu listeyi bir "katman" olarak
   gösterir, mobilde de sayfanın başında yatay çipler olarak çıkar. */

export const SETTINGS_SECTIONS = [
  { id: 'uygulama',          label: 'Uygulama',          icon: IC.info },
  { id: 'hesap',             label: 'Hesap',             icon: IC.user },
  { id: 'gizlilik',          label: 'Gizlilik',          icon: IC.lock },
  { id: 'gorunum',           label: 'Görünüm',           icon: IC.swatch },
  { id: 'islem-kurallari',   label: 'İşlem Kuralları',   icon: IC.bolt },
  { id: 'fon-stopaji',       label: 'Fon Stopajı',       icon: IC.receipt },
  { id: 'calisma-alanlari',  label: 'Çalışma Alanları',  icon: IC.family },
  { id: 'veri-yonetimi',     label: 'Veri Yönetimi',     icon: IC.database },
  { id: 'yedekleme',         label: 'Yedekleme',         icon: IC.cloud },
  { id: 'hata-kayitlari',    label: 'Hata Kayıtları',    icon: IC.warning },
  { id: 'demo-sifirlama',    label: 'Demo & Sıfırlama',  icon: IC.beaker },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

/** Yapışkan başlığın altında kalan okuma çizgisi (px). */
const SPY_LINE = 140

/** Pencere kaydırmasına göre o an okunan bölüm. Sayfanın sonuna gelindiyse son
 *  bölüm (kısa son kartlar hiçbir zaman çizgiye ulaşamaz). */
export function useActiveSettingsSection(): SettingsSectionId {
  const [active, setActive] = useState<SettingsSectionId>(SETTINGS_SECTIONS[0].id)

  useEffect(() => {
    let frame = 0
    const compute = () => {
      frame = 0
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom) {
        // Altta birden fazla kısa bölüm görünür olabilir; hash ile seçileni koru.
        const hash = window.location.hash.slice(1)
        const last = SETTINGS_SECTIONS[SETTINGS_SECTIONS.length - 1].id
        setActive(SETTINGS_SECTIONS.some(s => s.id === hash) && isVisible(hash) ? hash as SettingsSectionId : last)
        return
      }
      let current: SettingsSectionId = SETTINGS_SECTIONS[0].id
      for (const s of SETTINGS_SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && el.getBoundingClientRect().top <= SPY_LINE) current = s.id
      }
      setActive(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(compute) }
    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    window.addEventListener('hashchange', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('hashchange', onScroll)
    }
  }, [])

  return active
}

function isVisible(id: string) {
  const el = document.getElementById(id)
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.top < window.innerHeight && r.bottom > 0
}

/** Bölüme yumuşak kaydırır ve adresi günceller (paylaşılabilir/yenilenebilir). */
export function scrollToSettingsSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

interface Props {
  /** Satır sınıfı — kenar çubuğu varyantının kendi görünümü */
  rowCls: (active: boolean) => string
  iconSize?: number
  iconActive?: string
}

/** Kenar çubuğu katmanındaki dikey bölüm listesi. */
export function SettingsSectionList({ rowCls, iconSize = 17, iconActive = 'text-primary' }: Props) {
  const active = useActiveSettingsSection()
  return (
    <>
      {SETTINGS_SECTIONS.map(s => {
        const on = s.id === active
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={e => { e.preventDefault(); scrollToSettingsSection(s.id) }}
            aria-current={on ? 'location' : undefined}
            className={rowCls(on)}
          >
            <Icon d={s.icon} size={iconSize} className={on ? iconActive : ''} />
            <span className="flex-1 truncate">{s.label}</span>
          </a>
        )
      })}
    </>
  )
}

/** Kenar çubuğunun olmadığı dar ekranlar için yatay çip şeridi. */
export function SettingsSectionChips() {
  const active = useActiveSettingsSection()
  return (
    <nav aria-label="Ayarlar bölümleri" className="lg:hidden -mx-6 px-6 overflow-x-auto [scrollbar-width:none]">
      <div className="flex gap-2 w-max">
        {SETTINGS_SECTIONS.map(s => {
          const on = s.id === active
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={e => { e.preventDefault(); scrollToSettingsSection(s.id) }}
              aria-current={on ? 'location' : undefined}
              className={[
                'flex items-center gap-1.5 h-9 px-3 rounded-full border text-xs font-medium whitespace-nowrap transition-colors',
                on
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              <Icon d={s.icon} size={14} className={on ? 'text-primary' : ''} />
              {s.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}
