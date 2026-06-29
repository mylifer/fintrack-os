'use client'

import {
  Area, AreaChart, CartesianGrid, XAxis,
} from 'recharts'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatCompact } from '@/lib/utils/currency'
import type { MonthYear } from '@/types'

interface DataPoint {
  label: string
  netWorth: number
  my: MonthYear
}

interface Props {
  data: DataPoint[]
  selectedPeriod: MonthYear
}

const chartConfig = {
  netWorth: { label: 'Net Varlık', color: 'var(--chart-3)' },
} satisfies ChartConfig

export default function NetWorthLineChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
        Yeterli veri yok
      </div>
    )
  }

  return (
    <div className="chart-reveal">
      <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"   stopColor="var(--color-netWorth)" stopOpacity={0.8} />
              <stop offset="95%"  stopColor="var(--color-netWorth)" stopOpacity={0.1} />
            </linearGradient>
          </defs>
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
                formatter={(value) => [formatCompact(Number(value)), 'Net Varlık']}
                hideLabel
              />
            }
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="var(--color-netWorth)"
            strokeWidth={2}
            fill="url(#nwGrad)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
