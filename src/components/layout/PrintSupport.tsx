'use client'

import { useEffect } from 'react'

/* Yazdırma / PDF: tarayıcının kendi Ctrl+P'si dahil her baskıda koyu tema
   geçici olarak kaldırılır (koyu zemin mürekkep yakar, PDF'te okunmaz) ve
   baskı bitince geri konur. Gezinme öğeleri `print:hidden` ile gizlidir. */
export function PrintSupport() {
  useEffect(() => {
    let wasDark = false
    const before = () => {
      wasDark = document.documentElement.classList.contains('dark')
      document.documentElement.classList.remove('dark')
    }
    const after = () => {
      if (wasDark) document.documentElement.classList.add('dark')
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  return null
}

/** Sayfayı yazdırır; tarayıcının yazdırma penceresinden "PDF olarak kaydet" seçilebilir. */
export function PrintButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`print:hidden inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ${className}`}
      title="Yazdır ya da PDF olarak kaydet"
    >
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={14} height={14} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
      </svg>
      Yazdır / PDF
    </button>
  )
}
