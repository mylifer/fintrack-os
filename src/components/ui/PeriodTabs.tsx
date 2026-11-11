'use client'

import type { ReactNode } from 'react'
import { usePeriod } from '@/lib/hooks/usePeriod'
import { currentMonthYear, formatMonthYear, nextMonth, prevMonth } from '@/lib/utils/date'
import type { MonthYear, PeriodType } from '@/types'

const PERIODS: { type: PeriodType; label: string }[] = [
  { type: 'daily',     label: 'Günlük' },
  { type: 'weekly',    label: 'Haftalık' },
  { type: 'monthly',   label: 'Aylık' },
  { type: 'quarterly', label: '3 Aylık' },
  { type: 'yearly',    label: 'Yıllık' },
  { type: 'all',       label: 'Tüm Zamanlar' },
]

// Dokunma hedefleri mobilde ≥44px (w-11/h-11), lg'de eski yoğun ölçüler.
const navBtnCls = 'w-11 h-11 lg:w-6 lg:h-6 flex-shrink-0 flex items-center justify-center rounded-lg text-sm leading-none text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-40 disabled:pointer-events-none'
const tabBtnCls = 'flex-shrink-0 flex items-center px-3.5 min-h-11 lg:min-h-0 py-1.5 rounded-xl text-xs font-medium transition-colors'
const dateInputCls = 'flex-shrink-0 border border-border rounded-lg px-2 py-2 lg:py-1 text-xs text-foreground bg-card focus:outline-none focus:border-primary'

/** ‹ Kasım 2026 › — ortadaki ad, geçmiş/gelecek bir dönemdeyken "bugüne dön" düğmesidir. */
export function PeriodStepper({ label, atCurrent, onPrev, onNext, onToday, nextDisabled, unit = 'dönem' }: {
  label: string
  atCurrent: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  nextDisabled?: boolean
  /** Düğme adlarında kullanılır: "Önceki ay" / "Sonraki ay" */
  unit?: string
}) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button onClick={onPrev} className={navBtnCls} title={`Önceki ${unit}`} aria-label={`Önceki ${unit}`}>‹</button>
      <button
        onClick={onToday}
        disabled={atCurrent}
        title={atCurrent ? undefined : 'Bugüne dön'}
        className={[
          'flex items-center px-2 min-h-11 lg:min-h-0 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
          atCurrent ? 'text-foreground cursor-default' : 'text-primary hover:bg-secondary/60',
        ].join(' ')}
      >
        {label}
      </button>
      <button onClick={onNext} disabled={nextDisabled} className={navBtnCls} title={`Sonraki ${unit}`} aria-label={`Sonraki ${unit}`}>›</button>
    </div>
  )
}

/** Yalnız ay gösteren sayfaların (Bütçeler, Bütçe detayı, Aylık Özet) ay gezgini —
 *  PeriodTabs'teki gezinti şeridiyle aynı görünüm. */
export function MonthStepper({ month, onChange, nextDisabled }: {
  month: MonthYear
  onChange: (my: MonthYear) => void
  nextDisabled?: boolean
}) {
  const now = currentMonthYear()
  return (
    <PeriodStepper
      unit="ay"
      label={formatMonthYear(month)}
      atCurrent={month.year === now.year && month.month === now.month}
      onPrev={() => onChange(prevMonth(month))}
      onNext={() => onChange(nextMonth(month))}
      onToday={() => onChange(now)}
      nextDisabled={nextDisabled}
    />
  )
}

/** Sayfalar arası paylaşılan dönem seçici (bkz. ui.store): dönem sekmeleri,
 *  "Özel" aralık ve ‹ › gezinti. Bir sayfada seçilen dönem diğerlerinde de geçerlidir. */
export function PeriodTabs({ rightSlot }: { rightSlot?: ReactNode }) {
  const { type, offset, custom, from, to, label, setType, setOffset, setCustomRange } = usePeriod()

  /* Mobilde İKİ SATIR: üstte yatay kaydırılabilir dönem sekmeleri, altta dönem
     gezgini (ya da özel aralık) ve rightSlot. Hepsi tek bir `overflow-x-auto`
     satırındayken 375px'te gezgin ve "Fon getirileri dahil" gibi anahtarlar
     görünür alanın dışında kalıyordu. lg'de iki grup `contents` ile tek satıra
     açılır, rightSlot ml-auto ile sağa yaslanır. */
  return (
    <div className="print:hidden flex flex-col lg:flex-row lg:items-center lg:overflow-x-auto gap-1.5 lg:gap-1 px-4 lg:px-6 py-2 lg:py-3 border-b border-border/50 bg-transparent flex-shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto lg:contents">
        {PERIODS.map(p => (
          <button
            key={p.type}
            // Sekmeye basmak (aynı sekme dahil) güncel döneme döner
            onClick={() => setType(p.type)}
            aria-pressed={type === p.type && !custom}
            className={[
              tabBtnCls,
              type === p.type && !custom
                ? 'bg-secondary text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}

        <button
          onClick={() => setCustomRange(custom ?? { from: '', to: '' })}
          aria-pressed={!!custom}
          className={[
            tabBtnCls,
            custom
              ? 'bg-secondary text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          ].join(' ')}
        >
          Özel
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:contents">
        {custom ? (
          <div className="flex items-center gap-1.5 lg:ml-1 flex-shrink-0">
            <input
              type="date"
              aria-label="Başlangıç tarihi"
              value={custom.from || from}
              onChange={e => setCustomRange({ ...custom, from: e.target.value })}
              className={dateInputCls}
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input
              type="date"
              aria-label="Bitiş tarihi"
              value={custom.to || to}
              onChange={e => setCustomRange({ ...custom, to: e.target.value })}
              className={dateInputCls}
            />
          </div>
        ) : type !== 'all' && (
          // Dönem gezintisi — 'Tüm Zamanlar' ve özel aralıkta anlamsız, gizlenir
          <div className="lg:ml-2 flex-shrink-0">
            <PeriodStepper
              label={label}
              atCurrent={offset === 0}
              onPrev={() => setOffset(offset - 1)}
              onNext={() => setOffset(offset + 1)}
              onToday={() => setOffset(0)}
            />
          </div>
        )}

        {rightSlot && <div className="ml-auto lg:pl-3 flex-shrink-0 flex flex-wrap items-center gap-3">{rightSlot}</div>}
      </div>
    </div>
  )
}
