'use client'

import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis,
} from 'recharts'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  income: number
  expense: number
  my: MonthYear
}

interface Props {
  data: DataPoint[]
  selectedPeriod: MonthYear
}

const chartConfig = {
  income:  { label: 'Gelir',  color: 'var(--chart-2)' },
  expense: { label: 'Gider',  color: 'var(--chart-1)' },
} satisfies ChartConfig

export default function CashflowBarChart({ data }: Props) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} barGap={4} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          tickMargin={10}
          axisLine={false}
        />
        {/* İade ağırlıklı ayda toplam negatife düşebilir; varsayılan [0,auto]
            domain negatif barı kırpar. Eksen gizli, yalnız domain için. */}
        <YAxis hide domain={[(dataMin: number) => Math.min(0, dataMin), 'auto']} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              /* ChartTooltipContent, formatter dönüşünü satırın TAMAMI olarak
                 render eder — [değer, isim] tuple'ı recharts'ın kendi Tooltip
                 sözleşmesidir ve burada bitişik metin olarak basılır. Satır
                 (gösterge + isim + değer) burada eksiksiz kurulur. */
              formatter={(value, name) => (
                <div className="flex w-full items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ background: `var(--color-${name})` }}
                  />
                  <div className="flex flex-1 items-center justify-between gap-4 leading-none">
                    <span className="text-muted-foreground">
                      {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                    </span>
                    <span className="text-foreground font-medium tabular-nums">
                      {formatCompact(Number(value))}
                    </span>
                  </div>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income"  fill="var(--color-income)"  radius={[4, 4, 0, 0]} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
