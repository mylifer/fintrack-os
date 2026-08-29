'use client'

import { useEffect, useState } from 'react'
import type { AssetGroup, PricePoint } from '@/app/api/prices/history/route'

/* ── Paylaşılan fiyat-geçmişi önbelleği ──────────────────────────────────────
 * Sparkline'lar, birleşik portföy grafiği ve varlık detayı aynı seriyi ister.
 * /api/prices/history her istekte CDN'e gidiyor; aynı (seri, başlangıç) için
 * TEK uçuş yapılsın diye promise'ler modül seviyesinde önbelleklenir.
 * Fiyatlar GÜNLÜK olduğu için 10 dakikalık TTL yeterli.
 * ------------------------------------------------------------------------- */

export interface HistorySpec { group: AssetGroup; fundCode?: string; from: string }

export function histKey(s: HistorySpec): string {
  return `${s.group}|${s.fundCode ?? ''}|${s.from}`
}

const TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number; promise: Promise<PricePoint[]> }>()

export function fetchHistory(spec: HistorySpec): Promise<PricePoint[]> {
  const key = histKey(spec)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.promise

  const params = new URLSearchParams({ asset: spec.group, from: spec.from })
  if (spec.fundCode) params.set('code', spec.fundCode)
  const promise = fetch(`/api/prices/history?${params}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('history'))))
    .then((d: PricePoint[]) => d)
    .catch(err => { cache.delete(key); throw err })   // hata önbellekte kalmasın

  cache.set(key, { at: Date.now(), promise })
  return promise
}

/** Birden çok seriyi paralel çeker; her biri geldikçe kısmi sonuç yayınlar. */
export function useHistories(specs: HistorySpec[]): {
  series: Record<string, PricePoint[]>
  loading: boolean
  error: boolean
} {
  // specs referansı her render değişir; bağımlılık olarak anahtarları kullan.
  const keys = specs.map(histKey).join(',')
  const [series, setSeries] = useState<Record<string, PricePoint[]>>({})
  const [failed, setFailed] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!specs.length) return
    let alive = true
    for (const spec of specs) {
      const key = histKey(spec)
      fetchHistory(spec)
        .then(points => { if (alive) setSeries(s => ({ ...s, [key]: points })) })
        .catch(()    => { if (alive) setFailed(f => ({ ...f, [key]: true })) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  // loading/error TÜRETİLİR — efekt gövdesinde setState yok (zincirleme render).
  const settled = specs.filter(s => series[histKey(s)] || failed[histKey(s)]).length
  const loading = specs.length > 0 && settled < specs.length
  const error   = specs.length > 0 && specs.every(s => failed[histKey(s)])

  return { series, loading, error }
}

/** Tek seri — sparkline ve varlık detayı için. */
export function useHistory(spec: HistorySpec | null): {
  points: PricePoint[]
  loading: boolean
  error: boolean
} {
  const { series, loading, error } = useHistories(spec ? [spec] : [])
  return { points: spec ? (series[histKey(spec)] ?? []) : [], loading, error }
}

/** N gün önceki ISO tarih — seri başlangıcı. */
export function daysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().split('T')[0]
}
