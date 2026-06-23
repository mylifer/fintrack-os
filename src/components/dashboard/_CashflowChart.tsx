'use client'

import {
  Bar, BarChart, CartesianGrid, XAxis,
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
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name) => [formatCompact(Number(value)), name]}
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
