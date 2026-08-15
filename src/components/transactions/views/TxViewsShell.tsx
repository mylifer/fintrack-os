'use client'

import { useCallback, useState } from 'react'
import { DEFAULT_TX_VIEW, TX_VIEW_COOKIE, type TxViewId } from '@/lib/tx-view'
import { TableView }     from './TableView'
import { DayCardView }   from './DayCardView'
import { StatementView } from './StatementView'
import type { TxViewProps } from './shared'

/* ── İşlem listesi görünüm kabuğu ────────────────────────────────────────────
 * Hesap detayındaki işlem listesinin üç sunumu. Kabuk yalnızca hangisinin
 * basılacağını seçer; veri (filtre / dönem / planlanan işlemler) sayfada
 * hazırlanır, dolayısıyla görünüm değiştirmek listenin KAPSAMINI değiştirmez —
 * üçü de aynı işlemleri gösterir.
 *
 * Seçim ÇEREZDE tutulur ve sunucuda okunur (bkz. lib/tx-view.ts): sayfa ilk
 * HTML'den itibaren kullanıcının seçtiği görünümle gelir, Tablo'dan diğerine
 * atlama (sıçrama) olmaz. Kullanıcı değiştirene kadar gördüğü görünüm budur.
 * ------------------------------------------------------------------------- */
const VIEWS = [
  { id: 'table',     label: 'Tablo',     icon: TableIcon,     Comp: TableView },
  { id: 'daycard',   label: 'Gün Kartı', icon: CardIcon,      Comp: DayCardView },
  { id: 'statement', label: 'Ekstre',    icon: StatementIcon, Comp: StatementView },
] as const satisfies readonly { id: TxViewId; label: string; icon: () => React.ReactElement; Comp: unknown }[]

const ONE_YEAR = 60 * 60 * 24 * 365

// Görünüm çubuğunun listeden çaldığı yükseklik. Sayfa kolonunun yüksekliği
// sınırlı DEĞİL (ana layout `min-h-screen`), bu yüzden `h-full` çöker — liste
// viewport'a göre ölçülür. 220px liste öncesi sabit krom (başlık + dönem +
// hesap özeti + filtreler), 41px de bu çubuk.
const LIST_HEIGHT = 'h-[calc(100vh-261px)]'

export function TxViewsShell({
  initialView = DEFAULT_TX_VIEW,
  ...props
}: Omit<TxViewProps, 'heightClass'> & { initialView?: TxViewId }) {
  const [view, setView] = useState<TxViewId>(initialView)

  // SidebarVariantProvider ile aynı kalıp: state anında güncellenir, çerez
  // sonraki tam sayfa yüklemesi için yazılır. Çerez yazılamazsa (özel mod vb.)
  // tercih yalnızca bu oturumda geçerli olur — görünüm yine değişir.
  const pickView = useCallback((id: TxViewId) => {
    setView(id)
    try {
      document.cookie = `${TX_VIEW_COOKIE}=${id}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
    } catch (err) {
      console.error('[tx-view:persist]', err)
    }
  }, [])

  const Active = (VIEWS.find(v => v.id === view) ?? VIEWS[0]).Comp

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
function StatementIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M4 6h9M4 10h13M4 14h7M4 18h11" />
      <path d="M20 5.5v13" strokeDasharray="2 3" />
    </svg>
  )
}
