'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUndoStore, type UndoToast } from '@/store/undo.store'

/* Top-right stack of "geri al" toasts. Newest sits on top. Each toast shows a
   linear countdown bar draining over its remaining TTL, matching the auto-expiry
   scheduled in the undo store. Theme-aware via shadcn tokens only. */
export function UndoToaster() {
  const toasts  = useUndoStore(s => s.toasts)
  const runUndo = useUndoStore(s => s.runUndo)
  const dismiss = useUndoStore(s => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes undo-toast-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes undo-toast-bar {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
        {/* Render newest-first without mutating the store array. */}
        {[...toasts].reverse().map(t => (
          <UndoToastCard
            key={t.id}
            toast={t}
            onUndo={() => void runUndo(t.id)}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    </>
  )
}

function UndoToastCard({
  toast,
  onUndo,
  onDismiss,
}: {
  toast: UndoToast
  onUndo: () => void
  onDismiss: () => void
}) {
  // Countdown duration = TTL still remaining at mount time.
  const [duration] = useState(() => Math.max(0, toast.expiresAt - Date.now()))

  return (
    <div
      className="relative w-80 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg px-4 py-3"
      style={{ animation: 'undo-toast-in 180ms ease-out' }}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm">{toast.label}</span>
        <Button variant="ghost" size="sm" onClick={onUndo}>
          Geri Al
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Kapat"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <span
        className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-primary"
        style={{ width: '100%', animation: `undo-toast-bar ${duration}ms linear forwards` }}
      />
    </div>
  )
}
