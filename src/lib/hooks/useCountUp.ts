'use client'

import { useEffect, useRef, useState } from 'react'

export function useCountUp(target: number, duration = 900, startDelay = 300): number {
  const [value, setValue] = useState(0)
  const [ready, setReady] = useState(false)
  const fromRef  = useRef(0)
  const startRef = useRef<number | null>(null)
  const rafRef   = useRef<number | undefined>(undefined)

  // Isolated effect so it only fires once per mount.
  // StrictMode cancels+replaces the timer on the second invocation — safe.
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), startDelay)
    return () => clearTimeout(timer)
  }, [startDelay])

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Reduced-motion: jump to target immediately, bypass the delay
    if (reduced) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      fromRef.current = target
      setValue(target)
      return
    }

    // Not armed yet — collect latest target but don't animate
    if (!ready) return

    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const from = fromRef.current
    if (from === target) return

    startRef.current = null

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const progress = Math.min((ts - startRef.current) / duration, 1)
      const eased    = 1 - (1 - progress) ** 3
      const v        = from + (target - from) * eased
      fromRef.current = v
      setValue(v)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        fromRef.current = target
        setValue(target)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [ready, target, duration])

  return value
}
