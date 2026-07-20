'use client'

// ⚠️ GEÇİCİ TEŞHİS PANELİ — günlük>haftalık fon getirisi hatasını gerçek prod
// verisiyle kesinleştirmek için. Salt-okunur. Teşhis bitince silinecek.

import { useEffect, useMemo, useState } from 'react'
import { useTransactionStore, useInvestmentStore, useSettingsStore } from '@/store'
import { calcPeriodFlow } from '@/lib/utils/calculations'
import { computeHoldings } from '@/store/investment.store'
import { tefasCodesIn } from '@/lib/tefas'
import { calcFundPeriodGain, type FundPricePoint } from '@/lib/utils/fund-period-gain'
import { getPeriodRange } from '@/lib/utils/date'
import { formatCurrency } from '@/lib/utils/currency'

export default function DebugFundPage() {
  const transactions = useTransactionStore(s => s.transactions)
  const fundPrices   = useInvestmentStore(s => s.fundPrices)
  const prices       = useInvestmentStore(s => s.prices)
  const investTxs    = useInvestmentStore(s => s.transactions)
  const fetchPrices  = useInvestmentStore(s => s.fetchPrices)
  const includeFundGain = useSettingsStore(s => s.includeFundGain)

  useEffect(() => { fetchPrices() }, [fetchPrices])

  const daily  = useMemo(() => getPeriodRange('daily'), [])
  const weekly = useMemo(() => getPeriodRange('weekly'), [])

  const fundCodes = useMemo(() => tefasCodesIn(investTxs.map(t => t.asset)), [investTxs])
  const holdings  = useMemo(() => prices ? computeHoldings(investTxs, prices, fundPrices) : [], [investTxs, prices, fundPrices])

  // Haftalık geçmiş seriyi dashboard ile birebir aynı şekilde çek
  const [hist, setHist] = useState<Record<string, FundPricePoint[]>>({})
  useEffect(() => {
    const histFrom = new Date(new Date(weekly.from + 'T00:00:00Z').getTime() - 10 * 86_400_000).toISOString().slice(0, 10)
    for (const code of fundCodes) {
      fetch(`/api/prices/history?asset=TEFAS&code=${code}&from=${histFrom}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((pts: FundPricePoint[] | null) => {
          if (Array.isArray(pts) && pts.length) setHist(h => ({ ...h, [code]: pts }))
        })
        .catch(() => {})
    }
  }, [fundCodes, weekly.from])

  const cashDaily  = useMemo(() => calcPeriodFlow(transactions, daily.from, daily.to), [transactions, daily])
  const cashWeekly = useMemo(() => calcPeriodFlow(transactions, weekly.from, weekly.to), [transactions, weekly])

  const fundDaily  = useMemo(() => calcFundPeriodGain(investTxs, fundPrices, {}, daily.from, daily.to, true), [investTxs, fundPrices, daily])
  const fundWeekly = useMemo(() => calcFundPeriodGain(investTxs, fundPrices, hist, weekly.from, weekly.to, false), [investTxs, fundPrices, hist, weekly])

  const gate = (n: number) => (includeFundGain && n > 0 ? n : 0)
  const incDaily  = cashDaily.income  + gate(fundDaily)
  const incWeekly = cashWeekly.income + gate(fundWeekly)

  const box: React.CSSProperties = { border: '1px solid #ccc', borderRadius: 8, padding: 12, margin: '8px 0', fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap' }
  const bad = incDaily > incWeekly

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13 }}>
      <h2>🔎 Fon Getirisi Teşhis Paneli (geçici)</h2>
      <p>Bugün (from/to): günlük {daily.from} · haftalık {weekly.from} → {weekly.to}</p>
      <p>includeFundGain (checkbox): <b>{String(includeFundGain)}</b></p>

      <div style={{ ...box, background: bad ? '#fee' : '#efe' }}>
        <b>SONUÇ</b>
        {'\n'}Günlük Gelir  = nakit {formatCurrency(cashDaily.income)}  + fon(kapı) {formatCurrency(gate(fundDaily))}  = {formatCurrency(incDaily)}
        {'\n'}Haftalık Gelir = nakit {formatCurrency(cashWeekly.income)} + fon(kapı) {formatCurrency(gate(fundWeekly))} = {formatCurrency(incWeekly)}
        {'\n'}Günlük, haftalıktan yüksek mi? → {String(bad)}
      </div>

      <div style={box}>
        <b>NAKİT (calcPeriodFlow)</b>
        {'\n'}günlük  income={formatCurrency(cashDaily.income)}  expense={formatCurrency(cashDaily.expense)}
        {'\n'}haftalık income={formatCurrency(cashWeekly.income)} expense={formatCurrency(cashWeekly.expense)}
        {'\n'}(nakit haftalık, günlükten küçükse ASIL sorun burada)
      </div>

      <div style={box}>
        <b>FON GETİRİSİ (calcFundPeriodGain, ham/işaretli)</b>
        {'\n'}günlük  = {formatCurrency(fundDaily)}
        {'\n'}haftalık = {formatCurrency(fundWeekly)}
      </div>

      <div style={box}>
        <b>FON HOLDINGS</b>
        {holdings.filter(h => fundCodes.includes(tefasCodeOf(h.asset))).map(h =>
          `\n${h.asset}  qty=${h.quantity}  price=${h.currentPrice}  value=${h.currentValue.toFixed(2)}`
        ).join('') || '\n(fon holding yok)'}
      </div>

      <div style={box}>
        <b>CANLI FİYAT (fundPrices / fp)</b>
        {fundCodes.map(code => {
          const fp = fundPrices[code]
          return `\n${code}: ` + (fp ? `price=${fp.price} prevPrice=${fp.prevPrice} date=${fp.date}` : 'YOK')
        }).join('')}
      </div>

      <div style={box}>
        <b>HAFTALIK GEÇMİŞ SERİ (history/pts) — dönem {weekly.from}→{weekly.to}</b>
        {fundCodes.map(code => {
          const pts = hist[code] ?? []
          const within = pts.filter(p => p.date >= weekly.from && p.date <= weekly.to)
          const before = pts.filter(p => p.date < weekly.from)
          const last3 = pts.slice(-3).map(p => `${p.date}@${p.price}`).join(', ')
          return `\n${code}: toplam=${pts.length} | before(dönem öncesi)=${before.length}${before.length ? ` sonu=${before.at(-1)!.date}@${before.at(-1)!.price}` : ''} | within(dönem içi)=${within.length} | son3=[${last3}]`
        }).join('')}
      </div>
    </div>
  )
}

function tefasCodeOf(asset: string): string {
  // 'TEFAS:AFA' → 'AFA'
  return asset.startsWith('TEFAS:') ? asset.slice(6) : asset
}
