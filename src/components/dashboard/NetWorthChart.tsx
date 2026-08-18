'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { useTransactionStore, useAccountStore, useInvestmentStore, useDebtStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { calcNetWorth, calcNetRaw, excludeFuture, calcDebtBurden, buildDebtBurdenSeries } from '@/lib/utils/calculations'
import { getAssetPrice, computeHoldings, GOLD_GRAMS, assetLabel } from '@/store/investment.store'
import { isTefasAsset, tefasCode } from '@/lib/tefas'
import { baseAmount } from '@/lib/utils/fx'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import type { Transaction, InvestmentAsset, InvestmentTransaction } from '@/types'
import type { PricePoint } from '@/app/api/prices/history/route'
import type { NWDataPoint, NWTxItem } from './_NetWorthChart'

const Chart = dynamic(() => import('./_NetWorthChart'), {
  ssr: false,
  loading: () => <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

type Range = 'weekly' | 'monthly' | 'yearly' | 'all'

const RANGES: { key: Range; label: string }[] = [
  { key: 'weekly',  label: 'Haftalık'      },
  { key: 'monthly', label: 'Aylık'         },
  { key: 'yearly',  label: 'Yıllık'        },
  { key: 'all',     label: 'Tüm Zamanlar'  },
]

// Aralık seçimi YALNIZCA gösterilen pencereyi belirler; veri her zaman günlük
// çözünürlükte kalır (tooltip'te gün gün değişim görünür).
const RANGE_DAYS: Record<Range, number | null> = {
  weekly: 7, monthly: 30, yearly: 365, all: null,
}

const TREND_LABEL: Record<Range, string> = {
  weekly: 'son 7 günde', monthly: 'son 30 günde', yearly: 'son 1 yılda', all: 'tüm zamanlarda',
}

// Local date string YYYY-MM-DD (avoids UTC offset issues)
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface DayPoint { date: string; netWorth: number; delta: number; items: NWTxItem[] }

// Tooltip'te gün başına en fazla bu kadar işlem kalemi; kalanlar "+n işlem
// daha" toplamına katlanır (piyasa/kur satırı bu sınırın dışında, hep görünür)
const MAX_TOOLTIP_ITEMS = 4

function fmtQty(q: number): string {
  return q.toLocaleString('tr-TR', { maximumFractionDigits: 4 })
}

// Geçmiş fiyat serileri localStorage'da tutulur ki grafik ilk boyamada doğru
// şekliyle açılsın; taze veri arka planda çekilip önbelleğin üzerine yazılır.
// (Tarihi fiyatlar değişmez — bayatlama riski yalnızca son 1-2 gün, onu da
// ileri doldurma + canlı fiyat oran-ankrajı kapatır.)
const HIST_CACHE_KEY = 'networth-price-history-v1'

interface HistCacheEntry { from: string; points: PricePoint[] }

function readHistCache(): Record<string, HistCacheEntry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIST_CACHE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

// Bir yatırım varlığının geçmiş fiyat serisi anahtarı: TEFAS fonları kod
// bazında ayrı seri, tüm altın türleri tek GOLD (gram) serisinden çarpanla,
// dövizler kendi serisinden okunur.
function seriesKeyOf(asset: InvestmentAsset): string {
  if (isTefasAsset(asset)) return `TEFAS:${tefasCode(asset)}`
  if (asset.startsWith('GOLD')) return 'GOLD'
  return asset // USD | EUR | GBP
}

export function NetWorthChart() {
  const [range, setRange] = useState<Range>('all')

  const allTransactions = useTransactionStore(s => s.transactions)
  // Bakiye artık gelecek tarihli işlemleri içermiyor — geriye dönük yürüyüş de
  // aynı kümede (sadece işlenmiş işlemler) yapılmalı, yoksa geçmiş günler kayar.
  const transactions = useMemo(() => excludeFuture(allTransactions), [allTransactions])
  const accounts     = useAccountStore(useShallow(s => s.accounts.filter(a => !a.isArchived)))
  const prices       = useInvestmentStore(s => s.prices)
  const fundPrices   = useInvestmentStore(s => s.fundPrices)
  const investTxs    = useInvestmentStore(s => s.transactions)
  const investValue  = useMemo(
    () => prices ? computeHoldings(investTxs, prices, fundPrices).reduce((s, h) => s + h.currentValue, 0) : 0,
    [investTxs, prices, fundPrices],
  )

  // Net Varlık borçtan arındırılmıştır (dashboard kartıyla aynı değer) —
  // seri de gün gün o günün yükümlülüğünü düşer, yoksa son nokta başlıkla
  // uyuşmazdı. Ham dizi: kapanmış borçlar geçmişte hâlâ açıktı.
  const debts       = useDebtStore(useShallow(s => s.debts))
  const debtBurden  = calcDebtBurden(debts)
  const currentNW   = calcNetWorth(accounts, prices) + investValue - debtBurden

  // ── Geçmiş fiyat serileri ─────────────────────────────────────────
  // Yatırımlar gün gün GÜNÜN fiyatıyla değerlenmeli; bugünkü fiyatla değerleme
  // tüm kazancı alım gününe yığıp (dik sıçrama) sonrasını düz bırakıyordu.
  // İlk yatırım işleminden bugüne günlük seri /api/prices/history'den çekilir.
  const investEarliest = useMemo(() => {
    let min: string | null = null
    for (const tx of investTxs) {
      const key = tx.date.slice(0, 10)
      if (!min || key < min) min = key
    }
    return min
  }, [investTxs])

  const seriesKeys = useMemo(
    () => [...new Set(investTxs.map(tx => seriesKeyOf(tx.asset)))].sort(),
    [investTxs],
  )
  // Effect bağımlılığı DEĞER olarak string: investTxs referansı her store
  // güncellemesinde (Dexie load → bulut senkron pull) değişir; dizi referansına
  // bağlanmak içerik aynıyken bile yarıdaki fetch'i iptal edip baştan başlatıyordu.
  const seriesKeysStr = seriesKeys.join(',')

  // null = henüz hazır değil (ne önbellek ne fetch) → grafik yükleniyor gösterir.
  // Yanlış (canlı-fiyat sabitli) şekli önce çizip sonra düzeltmek kafa karıştırıyordu.
  const [histories, setHistories] = useState<Record<string, PricePoint[]> | null>(null)

  useEffect(() => {
    if (!investEarliest || !seriesKeysStr) return
    const keys = seriesKeysStr.split(',')
    const ctrl = new AbortController()

    // 1) Önbellekten anında doldur — sonraki açılışlar doğru şekliyle başlar.
    // Microtask: effect gövdesinde senkron setState cascading render uyarısı
    // veriyor; davranışça fark yok (fetch saniyeler, bu milisaniyeler sonra).
    Promise.resolve().then(() => {
      if (ctrl.signal.aborted) return
      const cache = readHistCache()
      const hit: Record<string, PricePoint[]> = {}
      for (const key of keys) {
        const entry = cache[key]
        // Önbellek yalnızca istenen aralığın tamamını kapsıyorsa geçerli
        // (daha eski tarihli bir işlem eklendiyse yeniden çekilmeli)
        if (entry && entry.from <= investEarliest && entry.points.length) hit[key] = entry.points
      }
      // Taze fetch sonuçları önbelleğin üzerine yazsın diye mevcut state öncelikli
      if (Object.keys(hit).length) setHistories(h => ({ ...hit, ...(h ?? {}) }))
    })

    // 2) Taze veriyi çek — seri başına BAĞIMSIZ: her seri gelir gelmez grafiğe
    // ve önbelleğe işlenir. Promise.all hepsini en yavaş kaynağa (TEFAS API
    // saniyelerce sürebiliyor) kilitliyordu; altın/döviz artık onu beklemez.
    let pending = keys.length
    for (const key of keys) {
      ;(async () => {
        const [group, code] = key.split(':')
        const params = new URLSearchParams({ asset: group, from: investEarliest })
        if (code) params.set('code', code)
        try {
          const res = await fetch(`/api/prices/history?${params}`, { signal: ctrl.signal })
          if (!res.ok) return
          const data: PricePoint[] = await res.json()
          if (ctrl.signal.aborted || !Array.isArray(data) || !data.length) return
          setHistories(h => ({ ...(h ?? {}), [key]: data }))
          try {
            const cache = readHistCache()
            cache[key] = { from: investEarliest, points: data }
            localStorage.setItem(HIST_CACHE_KEY, JSON.stringify(cache))
          } catch { /* quota/serialize hatası önbelleksiz devam */ }
        } catch { /* alınamayan seri map'e girmez → canlı fiyat sabitine düşer */ }
        finally {
          // Tüm seriler sonuçlandıysa (hepsi başarısız olsa bile) null→{}
          // geçişiyle yükleniyor durumu kapanır
          if (!ctrl.signal.aborted && --pending === 0) setHistories(h => h ?? {})
        }
      })()
    }
    return () => ctrl.abort()
  }, [investEarliest, seriesKeysStr])

  // Yatırım var ama seriler henüz hazır değil → grafik çizme, yükleniyor göster
  const histLoading = seriesKeys.length > 0 && histories === null

  // Günlük tam geçmiş — bugünden ilk işleme GÜN GÜN geriye yürür. Aylık/haftalık
  // kova yok; aralıklar bu diziden kesit alır. Tooltip delta'sı böylece her
  // aralıkta gerçek gün-gün değişimdir.
  //
  // Seri iki bileşenden kurulur:
  //  1. Nakit: bugünkü hesap bakiyelerinden calcNetRaw ile gün gün geriye
  //     (yatırım alım/satımlarının bağlı gider/gelir kayıtları zaten burada).
  //  2. Yatırım: gün sonu kümülatif miktar × o GÜNÜN fiyatı (geçmiş seri).
  //     Geçmiş seri yoksa canlı fiyat sabitine düşülür (eski davranış).
  const dailyData = useMemo<DayPoint[]>(() => {
    // Tek geçişte gün bazında kovalama — gün başına tüm defteri filtrelemek yerine
    const txByDay = new Map<string, Transaction[]>()
    let earliest: string | null = null

    for (const tx of transactions) {
      const key = tx.date.slice(0, 10)
      const bucket = txByDay.get(key)
      if (bucket) bucket.push(tx); else txByDay.set(key, [tx])
      if (!earliest || key < earliest) earliest = key
    }

    const todayStr = localDateStr(new Date())

    // Gün bazında miktar değişimi (alış +, satış −); gelecek tarihli işlemler hariç
    const qtyDeltaByDay  = new Map<string, Map<InvestmentAsset, number>>()
    const investTxByDay  = new Map<string, InvestmentTransaction[]>()
    for (const tx of investTxs) {
      const key = tx.date.slice(0, 10)
      if (key > todayStr) continue
      let m = qtyDeltaByDay.get(key)
      if (!m) { m = new Map(); qtyDeltaByDay.set(key, m) }
      m.set(tx.asset, (m.get(tx.asset) ?? 0) + (tx.type === 'buy' ? tx.quantity : -tx.quantity))
      const bucket = investTxByDay.get(key)
      if (bucket) bucket.push(tx); else investTxByDay.set(key, [tx])
      if (!earliest || key < earliest) earliest = key
    }
    if (!earliest) return []

    const days: string[] = []
    const cur = parseLocalDate(earliest)
    while (localDateStr(cur) <= todayStr) {
      days.push(localDateStr(cur))
      cur.setDate(cur.getDate() + 1)
    }

    // Seri → gün indeksli fiyat dizisi. Boş günler (hafta sonu, eksik CDN verisi)
    // son bilinen fiyatla ileri doldurulur; seri başından önceki günler ilk
    // bilinen fiyatla geri doldurulur (sıfır-değer uçurumu olmasın).
    const priceRows = new Map<string, number[]>()
    for (const [key, pts] of Object.entries(histories ?? {})) {
      const sorted = [...pts].sort((a, b) => (a.date < b.date ? -1 : 1))
      const row = new Array<number>(days.length)
      let j = 0, last = sorted[0].price
      for (let i = 0; i < days.length; i++) {
        while (j < sorted.length && sorted[j].date <= days[i]) { last = sorted[j].price; j++ }
        row[i] = last
      }
      priceRows.set(key, row)
    }

    // Varlık başına fiyat çözümü. Oran ankrajı: geçmiş seri (spot türevi) ile
    // canlı kaynak (Kapalıçarşı, ziynet premium'u) farklı fiyat evrenleri —
    // seri, bugünkü canlı fiyata oturacak şekilde ölçeklenir ki son gün
    // header'daki net varlıkla birebir kapansın.
    const assetSeries = [...new Set(investTxs.map(tx => tx.asset))].map(asset => {
      const live = prices ? getAssetPrice(asset, prices, fundPrices) : 0
      const mult = asset.startsWith('GOLD') ? (GOLD_GRAMS[asset] ?? 1) : 1
      const row  = priceRows.get(seriesKeyOf(asset))
      const histToday = row ? row[row.length - 1] * mult : 0
      const scale = live > 0 && histToday > 0 ? live / histToday : 1
      return { asset, row, mult, scale, live }
    })
    const seriesByAsset = new Map(assetSeries.map(s => [s.asset, s]))
    const priceOf = (asset: InvestmentAsset, i: number): number => {
      const s = seriesByAsset.get(asset)
      if (!s) return 0
      return s.row ? s.row[i] * s.mult * s.scale : s.live
    }

    // Günlük yatırım değeri: ileri yönde kümülatif miktar × günün fiyatı
    const investVal = new Array<number>(days.length).fill(0)
    if (prices) {
      const qty = new Map<InvestmentAsset, number>()
      for (let i = 0; i < days.length; i++) {
        const deltas = qtyDeltaByDay.get(days[i])
        // computeHoldings ile aynı kural: aşırı satış miktarı negatife düşürmez
        if (deltas) for (const [a, dq] of deltas) qty.set(a, Math.max(0, (qty.get(a) ?? 0) + dq))
        let v = 0
        for (const s of assetSeries) {
          const q = qty.get(s.asset)
          if (q) v += q * priceOf(s.asset, i)
        }
        investVal[i] = v
      }
    }

    // Yükümlülük serisi: bugünkü kalan borçtan gün gün geriye (o günden sonra
    // yapılan ödemeler geri eklenir; borç startDate'inden önce sayılmaz).
    // Borç ödemesi hem nakdi hem yükümlülüğü aynı tutarda düşürdüğü için net
    // varlık o gün DEĞİŞMEZ — grafikte sahte düşüş oluşmaz.
    const burden = buildDebtBurdenSeries(debts, transactions, days)

    // Nakit serisi: bugünkü hesap bakiyelerinden gün gün geriye
    const points: DayPoint[] = new Array(days.length)
    let cash = calcNetWorth(accounts, prices)

    for (let i = days.length - 1; i >= 0; i--) {
      const key = days[i]

      // Günün deltasını açıklayan kalemler: nakit işlemler (calcNetRaw ile aynı
      // kural — TRY-normalize gelir +, gider −, transfer etkisiz, mutabakat
      // dahil) + portföy giriş/çıkışları (günün fiyatıyla değerlenmiş)
      const items: NWTxItem[] = []
      for (const t of txByDay.get(key) ?? []) {
        if (t.type === 'transfer') continue
        const amount = t.type === 'income' ? baseAmount(t) : -baseAmount(t)
        if (amount !== 0) items.push({ label: t.description || (t.type === 'income' ? 'Gelir' : 'Gider'), amount })
      }
      if (prices) {
        for (const itx of investTxByDay.get(key) ?? []) {
          const value = itx.quantity * priceOf(itx.asset, i)
          if (value !== 0) items.push({
            label:  `Portföy: ${itx.type === 'buy' ? '+' : '−'}${fmtQty(itx.quantity)} ${assetLabel(itx.asset)}`,
            amount: itx.type === 'buy' ? value : -value,
          })
        }
      }

      // Günün noktası = gün SONU bakiyesi; sonra günün neti çıkarılıp önceki güne geçilir
      points[i] = { date: key, netWorth: Math.round((cash + investVal[i] - burden[i]) * 100) / 100, delta: 0, items }

      // Ham net (mutabakat DAHİL) — mutabakat kayıtları ham bakiyeyi gerçekten oynattı
      cash -= calcNetRaw(txByDay.get(key) ?? [])
    }

    for (let i = 1; i < points.length; i++) {
      points[i].delta = Math.round((points[i].netWorth - points[i - 1].netWorth) * 100) / 100
    }

    // Kalem listesini tooltip boyutuna indir ve açıklanamayan kalanı (mevcut
    // pozisyonların günlük fiyat/kur oynaması) tek satır olarak ekle
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      p.items.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      if (p.items.length > MAX_TOOLTIP_ITEMS) {
        const rest = p.items.splice(MAX_TOOLTIP_ITEMS)
        const restSum = Math.round(rest.reduce((s, it) => s + it.amount, 0) * 100) / 100
        p.items.push({ label: `+${rest.length} işlem daha`, amount: restSum })
      }
      if (i > 0) {
        const explained = p.items.reduce((s, it) => s + it.amount, 0)
        const residual  = Math.round((p.delta - explained) * 100) / 100
        // 5 kuruş eşiği: gün-sonu yuvarlama gürültüsü sahte satır üretmesin
        if (Math.abs(residual) >= 0.05) p.items.push({ label: 'Piyasa/kur hareketi', amount: residual })
      }
    }

    // Baştaki düz kısmı kırp: net varlığı hiç oynatmayan erken günler (kendi
    // hesapları arası transferler, yatırım alımları vb.) grafiği boş bir yatay
    // çizgiyle başlatır. İlk gerçek harekete kadar olan günleri at; son düz gün,
    // ilk yükselişin çıkış noktası olarak korunur.
    let start = 0
    while (start < points.length - 1 && points[start + 1].delta === 0) start++
    return start > 0 && points.length - start >= 2 ? points.slice(start) : points
  }, [transactions, accounts, investTxs, prices, fundPrices, histories, debts])

  const { data, trendLabel } = useMemo(() => {
    const windowDays = RANGE_DAYS[range]
    const window = windowDays ? dailyData.slice(-windowDays) : dailyData

    // X ekseni dataKey'i benzersiz `date`; `label` yalnızca tick metni. Boş
    // etiketli günler tick'lenmez — seyreltme burada yapılır ve en fazla ~8
    // etiket kalır (uzun aralıklarda ay etiketleri üst üste binmesin).
    const monthLabels = window.length > 40
    const withYear    = window.length > 366

    const data = window.map((p): NWDataPoint => {
      const d = parseLocalDate(p.date)
      return {
        date:      p.date,
        label:     '',
        fullLabel: d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }),
        netWorth:  p.netWorth,
        delta:     p.delta,
        items:     p.items,
      }
    })

    if (!monthLabels) {
      // ≤40 nokta: her step. güne "12 Tem"
      const step = Math.max(1, Math.ceil(data.length / 8))
      for (let i = 0; i < data.length; i += step) {
        data[i].label = parseLocalDate(data[i].date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
      }
    } else {
      // >40 nokta: ay başları; ay sayısı 8'i aşarsa her step. ay
      const monthStarts: number[] = []
      let seenMonth = ''
      data.forEach((p, i) => {
        const mk = p.date.slice(0, 7)
        if (mk !== seenMonth) { seenMonth = mk; monthStarts.push(i) }
      })
      const step = Math.max(1, Math.ceil(monthStarts.length / 8))
      for (let j = 0; j < monthStarts.length; j += step) {
        const i = monthStarts[j]
        data[i].label = parseLocalDate(data[i].date).toLocaleDateString('tr-TR', { month: 'short' })
          + (withYear ? ` '${data[i].date.slice(2, 4)}` : '')
      }
    }

    return { data, trendLabel: TREND_LABEL[range] }
  }, [dailyData, range])

  const first   = data[0]?.netWorth ?? currentNW
  const trend   = currentNW - first
  const pct     = first !== 0 ? (trend / Math.abs(first)) * 100 : 0
  const up      = trend >= 0
  // Seriler yüklenirken trend sayıları da yanlış (canlı-fiyat sabitli) seriden
  // gelir — grafiğiyle birlikte gizlenir
  const hasData = data.length >= 2 && !histLoading

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Varlık</p>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  range === r.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums leading-none">
            {formatCurrency(currentNW)}
          </p>
          {hasData && trend !== 0 && (
            <div className={`text-right shrink-0 ${up ? 'text-green-500' : 'text-destructive'}`}>
              <p className="text-sm font-semibold tabular-nums">
                {up ? '+' : ''}{formatCompact(trend)}
              </p>
              <p className="text-xs opacity-75">
                {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{trendLabel}</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {histLoading ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>
        ) : (
          <Chart data={data} />
        )}
      </CardContent>
    </Card>
  )
}
