import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import { calcFundPeriodGain, type FundPricePoint } from '@/lib/utils/fund-period-gain'
import { tefasCodesIn } from '@/lib/tefas'
import type { InvestmentTransaction, TefasFundPrice } from '@/types'

export function useFundPeriodGain({
  accountId, dateRange, isTodayPreset, investTxs, fundPrices, fetchPrices,
}: {
  accountId: string
  dateRange: { from: string; to: string }
  isTodayPreset: boolean
  investTxs: InvestmentTransaction[]
  fundPrices: Record<string, TefasFundPrice>
  fetchPrices: () => unknown
}) {
  /* ── Fon getirisi (gerçekleşmemiş) ──────────────────────────────────
     Dashboard'daki gelir kartıyla aynı hesap: seçili dönemin TEFAS fon
     değer kazancı. calcFundPeriodGain dönem sonunu tarihe göre alır — güncel
     dönemlerde canlı fiyat, geçmişte biten (özel) aralıklarda `to` gününe kadarki
     son kapanış — böylece her tarih aralığında doğru akar. Yalnız portföy geneli
     (Tüm Hesaplar) için anlamlıdır; tek hesap seçiliyken 0 tutulur (fon getirisi
     portföy geneli bir büyüklük). Dönem başı/sonu kapanışı için fon başına günlük
     seri bir kez çekilir (kod+dönem anahtarı; tarihi veri değişmez). */
  const fundEligible = accountId === 'all'
  const fundCodes    = useMemo(() => tefasCodesIn(investTxs.map(t => t.asset)), [investTxs])
  const [fundHistory, setFundHistory] = useState<Record<string, FundPricePoint[]>>({})
  const histRequested = useRef(new Set<string>())

  // Fon/FX fiyatlarını doldur (doğrudan /reports açılışında store boş olabilir).
  useEffect(() => { fetchPrices() }, [fetchPrices])

  // Dönem başı kapanış serisi ('Bugün' son iki kapanış farkını kullandığından
  // seri gerektirmez; uygun olmayan dönemlerde hiç istenmez).
  useEffect(() => {
    if (!fundEligible || isTodayPreset || fundCodes.length === 0) return
    const histFrom = format(subDays(parseISO(dateRange.from), 10), 'yyyy-MM-dd')
    for (const code of fundCodes) {
      const key = `${code}:${dateRange.from}`
      if (histRequested.current.has(key)) continue
      histRequested.current.add(key)
      fetch(`/api/prices/history?asset=TEFAS&code=${code}&from=${histFrom}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((pts: FundPricePoint[] | null) => {
          if (Array.isArray(pts) && pts.length) setFundHistory(h => ({ ...h, [key]: pts }))
          else histRequested.current.delete(key)
        })
        .catch(() => histRequested.current.delete(key))
    }
  }, [fundEligible, isTodayPreset, fundCodes, dateRange.from])

  const fundPeriodNet = useMemo(() => {
    if (!fundEligible) return 0
    const hist: Record<string, FundPricePoint[]> = {}
    for (const code of fundCodes) {
      const pts = fundHistory[`${code}:${dateRange.from}`]
      if (pts) hist[code] = pts
    }
    return calcFundPeriodGain(investTxs, fundPrices, hist, dateRange.from, dateRange.to, isTodayPreset)
  }, [fundEligible, fundCodes, fundHistory, investTxs, fundPrices, dateRange, isTodayPreset])

  return fundPeriodNet
}
