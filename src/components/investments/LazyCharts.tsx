'use client'

import dynamic from 'next/dynamic'

/* Yatırım grafikleri (Recharts) sayfanın ilk paketine girmesin: tahta önce
   özet ve tabloyla açılır, grafik kodu arkadan gelir. Görünümler grafikleri
   buradan alır; tipler (BuyPoint vb.) `import type` ile özgün dosyadan. */

function ChartSkeleton() {
  return <div className="h-[260px] rounded-xl border border-border/60 bg-card animate-pulse" aria-hidden />
}

export const PriceHistoryChart = dynamic(
  () => import('./PriceHistoryChart').then(m => m.PriceHistoryChart),
  { ssr: false, loading: ChartSkeleton },
)

export const PortfolioValueChart = dynamic(
  () => import('./board/PortfolioValueChart').then(m => m.PortfolioValueChart),
  { ssr: false, loading: ChartSkeleton },
)
