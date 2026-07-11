import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useUndoStore } from './undo.store'

/** Clear any leftover toasts (and their timers) between tests. */
function resetStore() {
  const { toasts, dismiss } = useUndoStore.getState()
  for (const t of [...toasts]) dismiss(t.id)
}

describe('undo.store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('pushUndo adds a toast', () => {
    useUndoStore.getState().pushUndo('İşlem silindi', async () => {})
    const { toasts } = useUndoStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].label).toBe('İşlem silindi')
    expect(typeof toasts[0].id).toBe('string')
  })

  it('auto-removes the toast after its ttl', () => {
    useUndoStore.getState().pushUndo('x', async () => {}, 6000)
    expect(useUndoStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(5999)
    expect(useUndoStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss removes the toast and a later timer fire is a no-op', () => {
    useUndoStore.getState().pushUndo('x', async () => {}, 6000)
    const id = useUndoStore.getState().toasts[0].id
    useUndoStore.getState().dismiss(id)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
    // The scheduled expiry must have been cleared — advancing past ttl neither
    // throws nor re-touches state.
    expect(() => vi.advanceTimersByTime(6000)).not.toThrow()
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })

  it('runUndo invokes the closure exactly once and removes the toast', async () => {
    const undo = vi.fn(async () => {})
    useUndoStore.getState().pushUndo('x', undo)
    const id = useUndoStore.getState().toasts[0].id
    await useUndoStore.getState().runUndo(id)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })

  it('double runUndo does not double-invoke the closure', async () => {
    const undo = vi.fn(async () => {})
    useUndoStore.getState().pushUndo('x', undo)
    const id = useUndoStore.getState().toasts[0].id
    await Promise.all([
      useUndoStore.getState().runUndo(id),
      useUndoStore.getState().runUndo(id),
    ])
    expect(undo).toHaveBeenCalledTimes(1)
    expect(useUndoStore.getState().toasts).toHaveLength(0)
  })
})
