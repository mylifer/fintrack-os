'use client'

import { useCountUp } from '@/lib/hooks/useCountUp'

export function AnimatedNumber({ value, format }: {
  value: number
  format: (v: number) => string
}) {
  const animated = useCountUp(value)
  return <>{format(animated)}</>
}
