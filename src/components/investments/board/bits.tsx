'use client'

import { useMemo } from 'react'
import { CLASS_META, CLASS_ORDER, classShade, fmtPct, pctLabel, pnlColor, type AssetClass, type AssetRow } from './shared'
import { formatCurrency } from '@/lib/utils/currency'

/* ── Yatırım tahtasının küçük parçaları ─────────────────────────────────────
 * Dört görünüm bunları paylaşır — aynı sparkline, aynı pay çubuğu, aynı K/Z
 * yazımı. Grafik kuralları: ince işaret (1.5–2px), yığılı segmentler arasında
 * 2px zemin boşluğu, metin veri rengini GİYMEZ (renk yanındaki işarette).
 * ------------------------------------------------------------------------- */

/** 30 günlük birim fiyat eğrisi. Değer değil FİYAT çizer — satır zaten değeri
 *  gösteriyor; eğri "fiyat nereye gidiyor" sorusunu yanıtlar. */
export function Sparkline({ values, w = 68, h = 22 }: { values: number[]; w?: number; h?: number }) {
  const d = useMemo(() => {
    if (values.length < 2) return null
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const stepX = w / (values.length - 1)
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`)
      .join(' ')
  }, [values, w, h])

  if (!d) return <span className="inline-block text-muted-foreground/50 text-[10px]">—</span>

  const up = values[values.length - 1] >= values[0]
  const stroke = up ? '#16a34a' : '#dc2626'

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Satırın portföy içindeki payı — sayının yanında ince bir çubuk. */
export function WeightBar({ weight, cls, w = 44 }: { weight: number; cls: AssetClass; w?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="rounded-full bg-secondary overflow-hidden" style={{ width: w, height: 4 }}>
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(2, weight * 100)}%`, background: CLASS_META[cls].color }}
        />
      </span>
      <span className="tabular-nums text-muted-foreground text-[11px] w-11 text-right">
        {pctLabel(weight)}
      </span>
    </span>
  )
}

/** Sınıf rozeti — renk kimliği metinde değil, metnin yanındaki işarette. */
export function ClassDot({ cls }: { cls: AssetClass }) {
  return (
    <span
      className="inline-block size-2 rounded-full flex-shrink-0"
      style={{ background: CLASS_META[cls].color }}
      aria-hidden
    />
  )
}

/** İşaretli K/Z tutarı + yüzdesi. */
export function PnlText({ pnl, pct, hasPrices }: { pnl: number; pct: number; hasPrices: boolean }) {
  if (!hasPrices) return <span className="text-muted-foreground">—</span>
  return (
    <span className={pnlColor(pnl)}>
      {(pnl >= 0 ? '+' : '−') + formatCurrency(Math.abs(pnl))}
      <span className="opacity-70"> · {fmtPct(pct)}</span>
    </span>
  )
}

/** Günlük değişim hücresi — önceki kapanış yoksa "—". */
export function DayCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>
  return <span className={pnlColor(pct)}>{fmtPct(pct)}</span>
}

/* ── %100 yığılı dağılım çubuğu ──────────────────────────────────────────── */

export interface AllocSegment { key: string; label: string; value: number; color: string }

/** Segmentler arasında 2px zemin boşluğu; uçlar yuvarlatılmış. */
export function AllocBar({
  segments, height = 14, onSelect, selectedKey,
}: {
  segments: AllocSegment[]
  height?: number
  onSelect?: (key: string) => void
  selectedKey?: string | null
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return null

  return (
    <div className="flex w-full" style={{ height, gap: 2 }}>
      {segments.map(s => {
        const pct = (s.value / total) * 100
        const dim = selectedKey != null && selectedKey !== s.key
        return (
          <button
            key={s.key}
            type="button"
            onClick={onSelect ? () => onSelect(s.key) : undefined}
            title={`${s.label} · ${formatCurrency(s.value)} · ${pctLabel(s.value / total)}`}
            aria-label={`${s.label} ${pctLabel(s.value / total)}`}
            className={`h-full rounded-[3px] transition-opacity ${onSelect ? 'cursor-pointer' : 'cursor-default'} ${dim ? 'opacity-35' : 'opacity-100'}`}
            style={{ width: `${pct}%`, background: s.color, minWidth: 3 }}
          />
        )
      })}
    </div>
  )
}

/** Dağılım çubuğunun açıklaması — her zaman var, kimlik renge bırakılmaz. */
export function AllocLegend({
  segments, onSelect, selectedKey,
}: {
  segments: AllocSegment[]
  onSelect?: (key: string) => void
  selectedKey?: string | null
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {segments.map(s => {
        const on = selectedKey == null || selectedKey === s.key
        return (
          <button
            key={s.key}
            type="button"
            onClick={onSelect ? () => onSelect(s.key) : undefined}
            className={`flex items-center gap-1.5 text-xs transition-opacity ${on ? 'opacity-100' : 'opacity-45'} ${onSelect ? 'hover:opacity-100' : 'cursor-default'}`}
          >
            <span className="size-2 rounded-full flex-shrink-0" style={{ background: s.color }} aria-hidden />
            <span className="text-foreground/90">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {total > 0 ? pctLabel(s.value / total) : '%0,0'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Satırlardan sınıf-içi renk basamaklı segment listesi üretir.
 *  Segmentler SINIFA GÖRE bitişik dizilir: aynı hue'nun açıklık basamakları
 *  çubuk üzerinde birbirinden kopmasın (turuncu-mavi-turuncu okunmuyordu). */
export function assetSegments(rows: AssetRow[]): AllocSegment[] {
  const perClass = new Map<AssetClass, number>()
  const seen     = new Map<AssetClass, number>()
  for (const r of rows) perClass.set(r.cls, (perClass.get(r.cls) ?? 0) + 1)

  const ordered = [...rows].sort((a, b) =>
    CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || b.currentValue - a.currentValue)

  return ordered.map(r => {
    const i = seen.get(r.cls) ?? 0
    seen.set(r.cls, i + 1)
    return {
      key:   r.asset,
      label: r.meta.label,
      value: r.currentValue,
      color: classShade(r.cls, i, perClass.get(r.cls) ?? 1),
    }
  })
}
