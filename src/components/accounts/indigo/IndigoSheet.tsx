'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { indigoFont } from './font'

/* İndigo alt panel — demodaki "bottom sheet": her ekran boyutunda alttan
   çıkar, geniş ekranda ortalanır (en çok 560px). İşlem ayrıntısı, ekstreler,
   taksitler ve kart bilgisi bu kabı paylaşır. Esc ve arka plan tıklaması
   kapatır; açılınca odak kapatma düğmesine, kapanınca önceki öğeye döner. */
export function IndigoSheet({
  title, onClose, children, labelledBy = 'indigo-sheet-title', hideTitle,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  labelledBy?: string
  /** Başlık içerikte zaten büyük basılıyorsa üst satırda tekrar gösterme */
  hideTitle?: boolean
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])

  return createPortal(
    <div className={`indigo-page ${indigoFont.className} fixed inset-0 z-50 !bg-transparent`} role="presentation">
      <button
        type="button"
        aria-label="Paneli kapat"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(10,10,30,.45)] animate-in fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="absolute bottom-0 left-1/2 max-h-[88vh] w-full max-w-[560px] -translate-x-1/2 overflow-y-auto rounded-t-[28px] bg-[var(--ip-sheet)] px-[22px] pt-3 pb-[calc(28px+env(safe-area-inset-bottom,0px))] text-[var(--ip-fg)] shadow-[0_-20px_60px_rgba(0,0,0,.25)] animate-in slide-in-from-bottom duration-300"
      >
        <div className="mx-auto mb-2 h-[5px] w-11 rounded-full bg-[var(--ip-fg)]/20" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={labelledBy} className={hideTitle ? 'sr-only' : 'text-[22px] font-extrabold tracking-tight'}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="ml-auto flex size-9 items-center justify-center rounded-full hover:bg-[var(--ip-surface2)]"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Demodaki gri anahtar–değer kutusu */
export function KeyValueList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-2 flex flex-col rounded-[18px] bg-[var(--ip-surface2)] px-4">
      {rows.map(([k, v], i) => (
        <div key={k} className={`flex justify-between gap-3 py-3 ${i ? 'border-t border-[var(--ip-line)]' : ''}`}>
          <dt className="text-[var(--ip-sub)]">{k}</dt>
          <dd className="m-0 min-w-0 text-right font-semibold break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SheetButtons({ children }: { children: ReactNode }) {
  return <div className="mt-[18px] flex gap-2.5">{children}</div>
}

export const sheetBtnPrimary = 'h-[50px] flex-1 rounded-full bg-[var(--ip-accent)] font-bold text-[var(--ip-accent-fg)] hover:brightness-95'
export const sheetBtnSecondary = 'h-[50px] flex-1 rounded-full bg-[var(--ip-surface2)] font-bold text-[var(--ip-fg)] hover:brightness-95'
