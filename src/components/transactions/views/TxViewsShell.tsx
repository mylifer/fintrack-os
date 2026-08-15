'use client'

import { useState } from 'react'
import { TableView }   from './TableView'
import { DayCardView } from './DayCardView'
import type { TxViewProps } from './shared'

/* ── İşlem listesi görünüm kabuğu ────────────────────────────────────────────
 * Hesap detayındaki işlem listesinin iki sunumu. Kabuk yalnızca hangisinin
 * basılacağını seçer; veri (filtre / dönem / planlanan işlemler) sayfada
 * hazırlanır, dolayısıyla görünüm değiştirmek listenin KAPSAMINI değiştirmez —
 * ikisi de aynı işlemleri, gerçekleşen + gelecek, birlikte gösterir.
 *
 * Seçim localStorage'da tutulur; sunucuda 'table' basılır (SSR'da window yok).
 * ------------------------------------------------------------------------- */
const VIEWS = [
  { id: 'table',   label: 'Tablo',     icon: TableIcon, Comp: TableView },
  { id: 'daycard', label: 'Gün Kartı', icon: CardIcon,  Comp: DayCardView },
] as const

type ViewId = (typeof VIEWS)[number]['id']
const STORAGE_KEY = 'accountDetail.txView'

// Görünüm çubuğunun listeden çaldığı yükseklik. Sayfa kolonunun yüksekliği
// sınırlı DEĞİL (ana layout `min-h-screen`), bu yüzden `h-full` çöker — liste
// viewport'a göre ölçülür. 220px liste öncesi sabit krom (başlık + dönem +
// hesap özeti + filtreler), 41px de bu çubuk.
const LIST_HEIGHT = 'h-[calc(100vh-261px)]'

export function TxViewsShell(props: Omit<TxViewProps, 'heightClass'>) {
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === 'undefined') return 'table'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved && VIEWS.some(v => v.id === saved) ? (saved as ViewId) : 'table'
  })

  function pickView(id: ViewId) {
    if (id === view) return
    setView(id)
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }

  const Active = VIEWS.find(v => v.id === view)!.Comp

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center border-b border-border px-6 py-1.5">
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
          {VIEWS.map(v => {
            const Icon = v.icon
            const on = v.id === view
            return (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                title={`${v.label} görünümü`}
                aria-pressed={on}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon />
                <span className="hidden sm:inline">{v.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Active {...props} heightClass={LIST_HEIGHT} />
      </div>
    </div>
  )
}

/* ── Seçici ikonları ───────────────────────────────────────────────────────── */
function TableIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 9v11" strokeLinecap="round" />
    </svg>
  )
}
function CardIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3" y="3" width="18" height="8" rx="2" />
      <rect x="3" y="13" width="18" height="8" rx="2" />
    </svg>
  )
}
