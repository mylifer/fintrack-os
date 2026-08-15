'use client'

import { useMemo, useState } from 'react'
import { today } from '@/lib/utils/date'
import { splitFuture, type TxViewProps } from './shared'
import { TableView }    from './TableView'
import { CompactView }  from './CompactView'
import { TimelineView } from './TimelineView'
import { CalendarView } from './CalendarView'

/* ── İşlem listesi görünüm kabuğu ────────────────────────────────────────────
 * Hesap detayındaki işlem listesinin dört alternatif sunumu. Kabuk yalnızca
 * hangisinin basılacağını seçer; veri (filtre/dönem/planlanan işlemler) sayfada
 * hazırlanır, dolayısıyla her görünüm AYNI listeyi — gerçekleşen + gelecek
 * işlemleri birlikte — gösterir.
 *
 * Seçim localStorage'da tutulur; SSR'da varsayılan 'table' basılır.
 * ------------------------------------------------------------------------- */
const VIEWS = [
  { id: 'table',    label: 'Tablo',     icon: TableIcon,    Comp: TableView },
  { id: 'compact',  label: 'Kompakt',   icon: ListIcon,     Comp: CompactView },
  { id: 'timeline', label: 'Akış',      icon: TimelineIcon, Comp: TimelineView },
  { id: 'calendar', label: 'Takvim',    icon: CalendarIcon, Comp: CalendarView },
] as const

type ViewId = (typeof VIEWS)[number]['id']
const STORAGE_KEY = 'accountDetail.txView'

// Toplu seçimi destekleyen görünümler — diğerlerine geçilince seçim temizlenir
// (ekranda görünmeyen satır toplu düzenlenmesin).
const SELECTABLE_VIEWS: ViewId[] = ['table', 'timeline']

// Kaydırma kabının yüksekliği. Sayfa kolonunun yüksekliği sınırlı DEĞİL (ana
// layout `min-h-screen`), bu yüzden `h-full` çöker — liste viewport'a göre
// ölçülür. 220px liste öncesi sabit krom (başlık + dönem + hesap özeti +
// filtreler); 45px de bu kabuğun eklediği görünüm çubuğu.
const LIST_HEIGHT = 'h-[calc(100vh-265px)]'

export function TxViewsShell({
  onClearSelection,
  ...props
}: Omit<TxViewProps, 'heightClass'> & { onClearSelection?: () => void }) {
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === 'undefined') return 'table'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved && VIEWS.some(v => v.id === saved) ? (saved as ViewId) : 'table'
  })

  function pickView(id: ViewId) {
    if (id === view) return
    setView(id)
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
    if (!SELECTABLE_VIEWS.includes(id)) onClearSelection?.()
  }

  const counts = useMemo(() => {
    const { future, past } = splitFuture(props.transactions, today())
    return { future: future.length, past: past.length }
  }, [props.transactions])

  const Active = VIEWS.find(v => v.id === view)!.Comp
  const selectable = props.selectable && SELECTABLE_VIEWS.includes(view)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Görünüm çubuğu — solda kapsam sayacı, sağda görünüm seçici */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-2">
        <span className="text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground/80 tabular-nums">{counts.past}</span> gerçekleşen
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-semibold text-sky-500 tabular-nums">{counts.future}</span> gelecek işlem
        </span>

        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
          {VIEWS.map(v => {
            const Icon = v.icon
            const on = v.id === view
            return (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                title={v.label}
                aria-pressed={on}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                  on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                <Icon />
                <span className="hidden md:inline">{v.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Active {...props} selectable={selectable} heightClass={LIST_HEIGHT} />
      </div>
    </div>
  )
}

/* ── Seçici ikonları ───────────────────────────────────────────────────────── */
function TableIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11" strokeLinecap="round"/></svg>
}
function ListIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
}
function TimelineIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M6 3v18"/><circle cx="6" cy="7.5" r="2"/><circle cx="6" cy="16.5" r="2"/><path d="M11 7.5h9M11 16.5h6"/></svg>
}
function CalendarIcon() {
  return <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round"/></svg>
}
