'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open) { d.showModal() } else { d.close() }
  }, [open])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    const handler = (e: MouseEvent) => {
      const r = d.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        onClose()
      }
    }
    d.addEventListener('click', handler)
    return () => d.removeEventListener('click', handler)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className={[
        'w-full bg-surface text-ink m-auto p-0',
        'border border-line rounded-2xl',
        'shadow-[0_8px_40px_rgba(0,0,0,0.6)]',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm',
        sizeClass[size],
      ].join(' ')}
    >
      {/* Inner wrapper handles max-height + scroll — NOT on <dialog> to avoid overriding display:none */}
      <div className="flex flex-col max-h-[90vh]">
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
            <h2 className="text-sm font-bold tracking-wide">{title}</h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-ground transition-colors text-lg leading-none"
              aria-label="Kapat"
            >
              ×
            </button>
          </div>
        )}
        <div className="p-6 overflow-y-auto min-h-0">{children}</div>
      </div>
    </dialog>
  )
}
