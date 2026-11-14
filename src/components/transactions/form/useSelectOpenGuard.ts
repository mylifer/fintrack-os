import { useEffect, useRef } from 'react'

export function useSelectOpenGuard() {
  // Track Select open state to prevent dialog from closing while a dropdown is open.
  // Radix DismissableLayer defers dialog's onInteractOutside to the "click" event,
  // by which time the Select has already closed. Snapshot the state on pointerdown
  // (capture phase, before any bubbling handler fires) for reliable detection.
  const selectOpenRef = useRef(false)
  const selectWasOpenRef = useRef(false)
  useEffect(() => {
    const snap = () => { selectWasOpenRef.current = selectOpenRef.current }
    document.addEventListener('pointerdown', snap, true)
    return () => document.removeEventListener('pointerdown', snap, true)
  }, [])
  const onSelectOpen = (open: boolean) => { selectOpenRef.current = open }

  return { selectWasOpenRef, onSelectOpen }
}
