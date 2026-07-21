'use client'

import { useEffect, useRef, useState } from 'react'

// First reveal starts here (× target) so the roll is short and near-target,
// never a long crawl up from 0.
const REVEAL_FRACTION = 0.9
// Widget targets recompute several times while async data streams in (fund
// gains, balances, recalcs). Coalesce those rapid changes so the number holds
// steady and then moves ONCE to the settled value — instead of chasing every
// intermediate target and visibly reversing.
const INITIAL_SETTLE = 260 // let the first batch of derived data settle
const RETARGET_SETTLE = 120 // later genuine changes (filter, new tx)

export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(() => target * REVEAL_FRACTION)

  const displayedRef = useRef(target * REVEAL_FRACTION) // latest painted value
  const revealedRef  = useRef(false)
  const rafRef       = useRef<number | undefined>(undefined)
  const startRef     = useRef<number | null>(null)
  const settleRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      displayedRef.current = target
      revealedRef.current = true
      setValue(target)
      return
    }

    const run = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      // First reveal begins near the target so the roll is short; every later
      // change continues smoothly from whatever is currently on screen.
      const from = revealedRef.current
        ? displayedRef.current
        : target * REVEAL_FRACTION

      if (from === target) {
        // Nothing to animate (e.g. target still 0). Stay un-revealed so the
        // first real value still gets its near-target reveal.
        displayedRef.current = target
        setValue(target)
        return
      }

      revealedRef.current = true
      startRef.current = null

      const animate = (ts: number) => {
        if (startRef.current === null) startRef.current = ts
        const progress = Math.min((ts - startRef.current) / duration, 1)
        const eased    = 1 - (1 - progress) ** 3
        const v        = from + (target - from) * eased
        displayedRef.current = v
        setValue(v)
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate)
        } else {
          displayedRef.current = target
          setValue(target)
        }
      }
      rafRef.current = requestAnimationFrame(animate)
    }

    // Freeze immediately on any target change (no chasing an old target), then
    // wait for the value to stop moving before animating to it once.
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
    if (settleRef.current) clearTimeout(settleRef.current)
    settleRef.current = setTimeout(run, revealedRef.current ? RETARGET_SETTLE : INITIAL_SETTLE)

    return () => {
      if (settleRef.current) clearTimeout(settleRef.current)
    }
  }, [target, duration])

  // Cancel any in-flight frame on unmount.
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return value
}
