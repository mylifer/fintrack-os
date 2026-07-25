'use client'

import { memo, useCallback, useRef } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { formatCompact, formatCurrency, formatAxisCompact } from '@/lib/utils/currency'

// Günün deltasını oluşturan kalem: işlem (TRY-normalize net etki), portföy
// giriş/çıkışı ya da kalan piyasa/kur hareketi. Liste üretici tarafta en fazla
// ~6 satıra indirgenmiş gelir ("+n işlem daha" toplamı dahil).
export interface NWTxItem { label: string; amount: number }

export interface NWDataPoint {
  date: string       // 'yyyy-MM-dd' — X ekseni dataKey'i. BENZERSİZ olmak zorunda:
                     // recharts eksen-tooltip'i payload'ı indeksle değil dataKey
                     // değeriyle arar (findEntryInArray); tekrar eden değer
                     // (örn. boş etiket) tooltip'in hep İLK eşleşen günü
                     // göstermesine yol açar.
  label: string      // axis tick — empty string = invisible tick
  fullLabel: string  // tooltip ("Ocak 2024")
  netWorth: number
  delta: number
  items: NWTxItem[]  // günün değişimini açıklayan kalemler
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: NWDataPoint }[]
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const { fullLabel, netWorth, delta, items } = payload[0].payload
  return (
    <div className="rounded-xl border border-border bg-background/95 backdrop-blur px-3.5 py-2.5 shadow-xl text-xs min-w-[120px] max-w-[260px]">
      <p className="text-muted-foreground mb-1.5 font-medium">{fullLabel}</p>
      <p className="text-sm font-semibold tabular-nums">{formatCurrency(netWorth)}</p>
      {delta !== 0 && (
        <p className={`mt-1 tabular-nums font-medium ${delta > 0 ? 'text-green-500' : 'text-destructive'}`}>
          {delta > 0 ? '+' : ''}{formatCompact(delta)}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-border/60 space-y-0.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground truncate">{it.label}</span>
              <span className={`tabular-nums shrink-0 ${it.amount > 0 ? 'text-green-500' : it.amount < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {it.amount > 0 ? '+' : ''}{formatCompact(it.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// Returns tick values as multiples of 50K covering [minVal, maxVal], capped at 6 ticks
function niceYTicks(minVal: number, maxVal: number): number[] {
  const BASE = 50_000
  const lo = Math.floor(minVal / BASE) * BASE
  const hi = Math.ceil(maxVal / BASE) * BASE
  const rawSteps = Math.round((hi - lo) / BASE) + 1
  // Scale step up in multiples of BASE so we never exceed 6 ticks
  const mult = Math.max(1, Math.ceil(rawSteps / 6))
  const step = BASE * mult
  const lo2 = Math.floor(minVal / step) * step
  const hi2 = Math.ceil(maxVal / step) * step
  const ticks: number[] = []
  for (let v = lo2; v <= hi2; v += step) ticks.push(v)
  return ticks
}

interface Props {
  data: NWDataPoint[]
}

// Net varlık çizgisinin soldan-sağa "çizilme" animasyonu için sabitler
const NW_DRAW_DUR = 1900
// easeInOutCubic — dengeli kalem hızı (iki uç yumuşak, orta sabit)
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// memo: dashboard'daki AnimatedNumber sayaç animasyonu üst bileşeni her karede
// (~1.5sn boyunca) yeniden render ediyordu; bu da recharts'ın SVG path düğümünü
// her karede yeniden yaratıp çizim animasyonunu koparıyordu. `data` referansı
// üst tarafta useMemo ile sabit tutulduğundan memo bu boş render'ları eler —
// düğüm sabit kalır, çizim tutar (ayrıca gereksiz recharts render'ı da önlenir).
function NetWorthLineChart({ data }: Props) {
  // Soldan sağa "çizim": recharts'ın çizdiği SVG çizgi path'ini (.recharts-area-curve)
  // stroke-dashoffset ile uzunluğu boyunca açarız — kalem, inişleri/çıkışları
  // izleyerek çizgiyi çiziyormuş gibi görünür. Dolgu (.recharts-area-area) çizim
  // biterken yumuşakça belirir.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setupRef = useRef(false)
  const rafRef = useRef(0)
  const startRef = useRef<number | null>(null) // çizim saati (path GÖRÜNDÜĞÜNDE başlar)
  const t0Ref = useRef(0)                       // kurulum anı (path bekleme zaman aşımı için)
  const doneRef = useRef(false)
  const obsRef = useRef<MutationObserver | null>(null)

  // O anki kareyi canlı düğümlere uygula (attribute ile — recharts inline-style'ı
  // sıfırlasa da attribute'a dokunmaz). Dönüş: 'wait' (path yok) | 'run' | 'done'.
  const applyFrame = useCallback((): 'wait' | 'run' | 'done' => {
    const r = rootRef.current
    const line = r?.querySelector<SVGPathElement>('.recharts-area-curve') ?? null
    let len = 0
    try { len = line && typeof line.getTotalLength === 'function' ? line.getTotalLength() : 0 } catch { len = 0 }
    if (!line || !len) return 'wait'

    if (startRef.current == null) startRef.current = performance.now()
    const p = Math.min(1, (performance.now() - startRef.current) / NW_DRAW_DUR)
    const e = easeInOutCubic(p)
    const area = r?.querySelector<SVGPathElement>('.recharts-area-area')

    if (p < 1) {
      // Çizgi: offset = len*(1-e) → soldan sağa açılır
      line.setAttribute('stroke-dasharray', String(len))
      line.setAttribute('stroke-dashoffset', String(len * (1 - e)))
      // Dolgu: çizgi çizilirken gizli, son %45'te 0→1 belirir
      if (area) area.setAttribute('opacity', String(p < 0.55 ? 0 : (p - 0.55) / 0.45))
      return 'run'
    }
    // Bitti: kendi attribute'larımızı kaldır → çizgi/dolgu tamamen normale döner
    line.removeAttribute('stroke-dasharray')
    line.removeAttribute('stroke-dashoffset')
    area?.removeAttribute('opacity')
    return 'done'
  }, [])

  // Çizim TAMAMEN imperatif yürütülür (setState YOK: store hidrasyonu + recharts
  // render'ıyla birleşince "Maximum update depth" döngüsüne giriyordu).
  //
  // Zorluklar ve çözümleri:
  //  • Hidrasyonda div mount→unmount→remount olur (data geçici <2 → fallback).
  //    → rAF döngüsü tek sefer başlar (setupRef) ve canlı düğümü HER KAREDE rootRef
  //      üzerinden okur; geçici unmount'ta iptal edilmez, remount'ta devam eder.
  //  • Yatırımlı kullanıcıda mount sonrası fiyat serileri asenkron gelip path'i
  //    yeniden yaratır. → kare-kare çizim ileri gitmeye devam eder (sahipsiz
  //    kalmaz/reset olmaz), path göründüğü an başlar (uzun boş ekran yok).
  //  • Yeni path düğümü bir kare "tam çizgi" parlayabilir. → MutationObserver her
  //    mount'ta GÜNCEL root'a bağlanır ve yeni düğümü BOYAMADAN ÖNCE (microtask)
  //    mevcut kareye ayarlar → parlama/reset görünmez.
  const chartRef = useCallback((root: HTMLDivElement | null) => {
    rootRef.current = root
    if (!root || doneRef.current) return

    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { doneRef.current = true; return }

    // Observer'ı GÜNCEL root'a (yeniden) bağla — remount'ta yeni div'i izlesin
    obsRef.current?.disconnect()
    const obs = new MutationObserver(() => { if (!doneRef.current) applyFrame() })
    obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['d'] })
    obsRef.current = obs

    applyFrame() // path zaten varsa boyamadan önce ayarla (parlama olmaz)

    if (setupRef.current) return // rAF döngüsü zaten çalışıyor
    setupRef.current = true
    t0Ref.current = performance.now()

    const step = () => {
      if (doneRef.current) return
      const s = applyFrame()
      if (s === 'done') {
        doneRef.current = true
        obsRef.current?.disconnect(); obsRef.current = null
        return
      }
      // 'wait' → path henüz yok; ~8sn boyunca dene. 'run' → devam.
      if (s === 'run' || performance.now() - t0Ref.current < 8000) {
        rafRef.current = requestAnimationFrame(step)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }, [applyFrame])

  if (data.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        Grafik için en az 2 günlük veri gerekli
      </div>
    )
  }

  const values = data.map(d => d.netWorth)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const ticks  = niceYTicks(minVal, maxVal)
  const showRef = ticks[0] < 0

  // Etiketli günler açık tick listesi olarak verilir (dataKey benzersiz `date`
  // olduğundan hangi günlerin etiketleneceğini `label` alanı belirler)
  const labelOf = new Map(data.map(p => [p.date, p.label]))
  const xTicks  = data.filter(p => p.label !== '').map(p => p.date)

  return (
    <div ref={chartRef} className="w-full px-4">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
          <defs>
            {/* Çizgi altı yumuşak gradyan dolgu — tepede belirgin, dibe doğru şeffaf */}
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--primary)" stopOpacity={0.28} />
              <stop offset="70%"  stopColor="var(--primary)" stopOpacity={0.04} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="currentColor"
            strokeOpacity={0.07}
          />
          <XAxis
            dataKey="date"
            ticks={xTicks}
            tickFormatter={d => labelOf.get(d as string) ?? ''}
            tickLine={false}
            axisLine={false}
            dy={6}
            interval={0}
            padding={{ left: 16, right: 16 }}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          <YAxis
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={52}
            ticks={ticks}
            domain={[ticks[0] ?? 0, ticks[ticks.length - 1] ?? 1]}
            tickFormatter={v => formatAxisCompact(v as number)}
            tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
          />
          {showRef && (
            <ReferenceLine
              y={0}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeDasharray="4 4"
            />
          )}
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: 'currentColor', strokeOpacity: 0.12, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#nwFill)"
            fillOpacity={1}
            // Dolgu, çizgiden grafiğin dibine (alan alt sınırına) kadar iner
            baseValue={ticks[0] ?? 0}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--primary)',
              stroke: 'var(--background)',
              strokeWidth: 2.5,
            }}
            // Soldan sağa çizim path'in stroke-dashoffset animasyonuyla
            // (yukarıdaki chartRef callback'i) yapılıyor. Recharts'ın kendi
            // animasyonu kapalı: fiyat güncellemesi ilk boyamayı yarıda kesip
            // şekil-morph'una çeviriyordu ve dashoffset draw'ı bozuyordu.
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default memo(NetWorthLineChart)
