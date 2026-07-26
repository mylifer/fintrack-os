'use client'

import type { ReactNode } from 'react'
import { useUIStore } from '@/store'
import type { PeriodType } from '@/types'

const PERIODS: { type: PeriodType; label: string }[] = [
  { type: 'daily',   label: 'Günlük' },
  { type: 'weekly',  label: 'Haftalık' },
  { type: 'monthly', label: 'Aylık' },
  { type: 'yearly',  label: 'Yıllık' },
  { type: 'all',     label: 'Tüm Zamanlar' },
]

interface Nav {
  offset: number
  label: string
  onChange: (offset: number) => void
}

// Özel (custom) tarih aralığı — yalnız bu prop verildiğinde ("Özel" sekmesi +
// tarih girdileri) çizilir. Global periodType'a dokunmadan sayfa-yerel bir aralık
// (dashboard'daki gibi) sunar; verilmeyen sayfalarda hiç görünmez.
interface CustomRange {
  active: boolean
  from: string
  to: string
  onActivate: () => void
  onExit: () => void
  onChange: (patch: { from?: string; to?: string }) => void
}

export function PeriodTabs({ rightSlot, nav, custom }: { rightSlot?: ReactNode; nav?: Nav; custom?: CustomRange }) {
  const periodType    = useUIStore(s => s.periodType)
  const setPeriodType = useUIStore(s => s.setPeriodType)

  // Dokunma hedefleri mobilde ≥44px (w-11/h-11), lg'de eski yoğun ölçüler.
  const navBtnCls = 'w-11 h-11 lg:w-6 lg:h-6 flex-shrink-0 flex items-center justify-center rounded-lg text-sm leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors'
  const tabBtnCls = 'flex-shrink-0 flex items-center px-3.5 min-h-11 lg:min-h-0 py-1.5 rounded-xl text-xs font-medium transition-colors'
  const dateInputCls = 'flex-shrink-0 border border-border rounded-lg px-2 py-2 lg:py-1 text-xs text-foreground bg-card focus:outline-none focus:border-primary'

  /* Mobilde İKİ SATIR: üstte yatay kaydırılabilir dönem sekmeleri, altta
     rightSlot. Eskiden hepsi tek bir `overflow-x-auto` satırındaydı ve
     `ml-auto` olan rightSlot (ör. "Fon getirileri dahil" / "Gelecek işlemler"
     anahtarı) 375px'te görünür alanın ~200px dışında kalıyordu — kullanıcı bir
     sekme şeridini yatay kaydırmadan o anahtarı hiç göremiyordu. lg'de düzen
     eskisi gibi tek satır + ml-auto. */
  return (
    <div className="flex flex-col lg:flex-row lg:items-center lg:overflow-x-auto gap-1.5 lg:gap-1 px-4 lg:px-6 py-2 lg:py-3 border-b border-border/50 bg-transparent flex-shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto lg:contents">
      {PERIODS.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => { setPeriodType(type); custom?.onExit() }}
          className={[
            tabBtnCls,
            periodType === type && !custom?.active
              ? 'bg-secondary text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          ].join(' ')}
        >
          {label}
        </button>
      ))}

      {custom && (
        <>
          <button
            onClick={custom.onActivate}
            className={[
              tabBtnCls,
              custom.active
                ? 'bg-secondary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
            ].join(' ')}
          >
            Özel
          </button>
          {custom.active && (
            <div className="flex items-center gap-1.5 ml-1 flex-shrink-0">
              <input
                type="date"
                value={custom.from}
                onChange={e => custom.onChange({ from: e.target.value })}
                className={dateInputCls}
              />
              <span className="text-muted-foreground text-xs">—</span>
              <input
                type="date"
                value={custom.to}
                onChange={e => custom.onChange({ to: e.target.value })}
                className={dateInputCls}
              />
            </div>
          )}
        </>
      )}

      {/* Dönem gezintisi — 'Tüm Zamanlar'da anlamsız, gizlenir */}
      {nav && periodType !== 'all' && (
        <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
          <button onClick={() => nav.onChange(nav.offset - 1)} className={navBtnCls} title="Önceki dönem">‹</button>
          <button
            onClick={() => nav.onChange(0)}
            title={nav.offset !== 0 ? 'Bugüne dön' : undefined}
            className={[
              'flex items-center px-2 min-h-11 lg:min-h-0 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              nav.offset !== 0
                ? 'text-primary hover:bg-secondary/60'
                : 'text-foreground cursor-default',
            ].join(' ')}
          >
            {nav.label}
          </button>
          <button onClick={() => nav.onChange(nav.offset + 1)} className={navBtnCls} title="Sonraki dönem">›</button>
        </div>
      )}

      </div>

      {rightSlot && <div className="lg:ml-auto lg:pl-3 flex-shrink-0 flex items-center">{rightSlot}</div>}
    </div>
  )
}
