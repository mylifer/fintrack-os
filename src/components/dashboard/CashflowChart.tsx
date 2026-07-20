'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useTransactionStore, useUIStore } from '@/store'
import { calcMonthlyFlow } from '@/lib/utils/calculations'
import { lastNMonths } from '@/lib/utils/date'
import { formatCompact } from '@/lib/utils/currency'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

const Chart = dynamic(() => import('./_CashflowChart'), {
  ssr: false,
  loading: () => <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Yükleniyor…</div>,
})

export function CashflowChart() {
  const transactions   = useTransactionStore(s => s.transactions)
  const selectedPeriod = useUIStore(s => s.selectedPeriod)

  // Nakit akışı = yalnızca gerçek nakit gelir/gider. Gerçekleşmemiş fon getirisi
  // (kâğıt üzerindeki değer artışı, hiç nakit hareketi yok) bilerek EKLENMEZ —
  // o yalnızca "Gelir" özet kartında gösterilir. Barlara enjekte etmek gerçek
  // olmayan bir nakit girişi gibi görünüyordu (tek kovaya yığılan "hayali gelir").
  const data = useMemo<DataPoint[]>(() => {
    const months = lastNMonths(6)
    return months.map(my => {
      const { income, expense } = calcMonthlyFlow(transactions, my)
      return {
        label: new Date(my.year, my.month - 1).toLocaleDateString('tr-TR', { month: 'short' }),
        income, expense, my,
      }
    })
  }, [transactions])

  // Seçili dönem 6 aylık pencerenin dışındaysa uydurma bir "+₺0 net" göstermek
  // yerine footer satırı gizlenir (null ≠ sıfır).
  const currentData = data.find(d => d.my.month === selectedPeriod.month && d.my.year === selectedPeriod.year)
  const net = currentData ? currentData.income - currentData.expense : null
  const up  = (net ?? 0) >= 0
  const periodLabel = new Date(selectedPeriod.year, selectedPeriod.month - 1)
    .toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nakit Akışı</CardTitle>
        <CardDescription>Son 6 aylık gelir ve gider karşılaştırması</CardDescription>
      </CardHeader>
      <CardContent>
        <Chart data={data} selectedPeriod={selectedPeriod} />
      </CardContent>
      <CardFooter className="flex-col items-start gap-2 text-sm">
        {net !== null && (
          <div className={`flex gap-2 font-medium leading-none ${up ? 'text-green-600' : 'text-destructive'}`}>
            {periodLabel} {up ? '+' : '−'}{formatCompact(Math.abs(net))} net{' '}
            {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          </div>
        )}
        {net === null && (
          <div className="text-muted-foreground leading-none">
            Seçili dönem ({periodLabel}) grafikteki 6 aylık pencerenin dışında
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
