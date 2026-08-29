'use client'

import type { PriceData, TefasFundPrice } from '@/types'

/* Canlı fiyat şeridi — sayfanın üstünde, dört görünümde de aynı. */

export function PriceTicker({
  prices, fundPrices, wsFundCodes, loading, error, onRefresh,
}: {
  prices:      PriceData | null
  fundPrices:  Record<string, TefasFundPrice>
  wsFundCodes: Set<string>
  loading:     boolean
  error:       string | null
  onRefresh:   () => void
}) {
  const updatedAt = prices?.updatedAt
    ? new Date(prices.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="px-6 py-3 border-b border-border/50 bg-card flex items-center gap-6 overflow-x-auto flex-shrink-0">
      {prices ? (
        <>
          <Ticker label="USD/TRY"  value={prices.usdTry.toFixed(2)} current={prices.usdTry} previous={prices.prevUsdTry} />
          <Ticker label="EUR/TRY"  value={prices.eurTry.toFixed(2)} current={prices.eurTry} previous={prices.prevEurTry} />
          <Ticker label="GBP/TRY"  value={prices.gbpTry.toFixed(2)} current={prices.gbpTry} previous={prices.prevGbpTry} />
          <Ticker
            label="Altın/gr"
            value={`₺${prices.goldGramTry.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
            current={prices.goldGramTry}
            previous={prices.prevGoldGramTry}
          />
          {prices.bilezikGramTry ? (
            <Ticker
              label="Bilezik/gr"
              value={`₺${prices.bilezikGramTry.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`}
              current={prices.bilezikGramTry}
              previous={prices.prevBilezikGramTry}
            />
          ) : null}
          {Object.values(fundPrices)
            .filter(fp => wsFundCodes.has(fp.code))
            .sort((a, b) => a.code.localeCompare(b.code))
            .map(fp => (
              <Ticker
                key={fp.code}
                label={fp.code}
                value={`₺${fp.price.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}`}
                current={fp.price}
                previous={fp.prevPrice}
              />
            ))}
          <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            {error && <span className="text-xs text-destructive font-medium">{error}</span>}
            <span className="text-xs text-muted-foreground">
              {loading ? 'Güncelleniyor...' : updatedAt ? `Son: ${updatedAt}` : ''}
            </span>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="text-xs text-primary font-semibold hover:text-primary/80 disabled:opacity-40 transition-colors"
            >
              {loading ? '...' : 'Yenile'}
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {loading ? 'Fiyatlar yükleniyor...' : error ? `Fiyatlar alınamadı: ${error}` : 'Fiyat verisi yok'}
          </span>
          {!loading && (
            <button
              onClick={onRefresh}
              className="text-xs text-primary font-semibold hover:text-primary/80 transition-colors"
            >Tekrar Dene</button>
          )}
        </div>
      )}
    </div>
  )
}

function Ticker({ label, value, current, previous }: {
  label: string; value: string; current: number; previous?: number
}) {
  const pct = previous && previous > 0 ? ((current - previous) / previous) * 100 : null

  return (
    <div className="flex-shrink-0">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-0.5">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-medium tabular-nums text-foreground">{value}</span>
        {pct !== null && (
          <span className={[
            'text-xs font-medium tabular-nums flex items-center gap-0.5',
            pct > 0 ? 'text-green-600' : pct < 0 ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}>
            {pct > 0 ? '▲' : pct < 0 ? '▼' : ''}
            {Math.abs(pct).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}
