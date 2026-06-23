'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose,
} from '@/components/ui/dialog'
import { XIcon } from 'lucide-react'

interface ModalProps {
  open:     boolean
  onClose:  () => void
  title?:   string
  children: ReactNode
  size?:    'sm' | 'md' | 'lg'
}

const sizeClass = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn('gap-0 p-0 max-h-[90vh] flex flex-col', sizeClass[size])}
      >
        {title && (
          <DialogHeader className="flex-row items-center justify-between px-6 py-4 border-b border-white/[0.07] flex-shrink-0">
            <DialogTitle className="text-sm font-semibold tracking-wide text-foreground">
              {title}
            </DialogTitle>
            <DialogClose
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
              aria-label="Kapat"
            >
              <XIcon className="size-4" />
            </DialogClose>
          </DialogHeader>
        )}
        <div className="p-6 overflow-y-auto min-h-0 flex-1">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}
