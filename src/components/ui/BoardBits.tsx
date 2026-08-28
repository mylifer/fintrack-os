'use client'

import { matchRange } from '@/lib/utils/boardText'

/* Liste/tahta sayfalarının (Alıcılar, Aile Üyeleri, Kategoriler) paylaştığı
   küçük parçalar. Sayfalar arasında tutarlılığı bunlar sağlıyor: aynı
   vurgulama, aynı aksiyon ikonları, aynı "bekleyen" rozeti, aynı sıralanabilir
   kolon başlığı. */

/** Metnin arama ile eşleşen parçasını vurgular. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const range = matchRange(text, query)
  if (!range) return <>{text}</>
  const [a, b] = range
  return (
    <>
      {text.slice(0, a)}
      <mark className="bg-primary/25 text-foreground rounded-[3px] px-px">{text.slice(a, b)}</mark>
      {text.slice(b)}
    </>
  )
}

/** Satır üstündeki düzenle + arşivle. `onArchive` verilmezse arşiv düğmesi hiç
 *  basılmaz — sistem kategorileri gibi arşivlenemeyen kayıtlar için. */
export function RowActions({
  name, onEdit, onArchive, className = '',
}: {
  /** Erişilebilirlik etiketleri için kaydın adı. */
  name: string
  onEdit: () => void
  onArchive?: () => void
  className?: string
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    fn()
  }

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={stop(onEdit)}
        title="Düzenle"
        aria-label={`${name} düzenle`}
        className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      {onArchive && (
        <button
          type="button"
          onClick={stop(onArchive)}
          title="Arşivle"
          aria-label={`${name} arşivle`}
          className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <path d="M10 12h4" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Akış dışı (onay bekleyen / tarihi gelmemiş / mutabakat / anapara) bağlı satır
 *  sayısı. Tutarlara girmediği için ayrıca gösterilir — sayı kaybolmuş gibi
 *  durmasın. */
export function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      title={`${count} işlem toplamlara girmiyor (onay bekleyen, tarihi gelmemiş ya da anapara hareketi)`}
      className="text-[10px] font-medium tabular-nums text-sky-500/90 whitespace-nowrap"
    >
      +{count} bekleyen
    </span>
  )
}

/** Net tutarın işaret rengi. Sıfır nötr kalır — "±0" bir kazanç/kayıp değil. */
export function netTone(net: number): string {
  if (net > 0) return 'text-green-600'
  if (net < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

/** Tıklanınca sıralamayı değiştiren tablo başlığı. */
export function SortTh<S extends string>({
  id, sort, onSort, className, children,
}: {
  id: S
  sort: S
  onSort: (s: S) => void
  className?: string
  children: React.ReactNode
}) {
  const on = sort === id
  return (
    <th className={`py-2 font-semibold ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(id)}
        aria-pressed={on}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors ${
          on ? 'text-foreground' : 'hover:text-foreground'
        }`}
      >
        {children}
        <span className={`text-[8px] leading-none ${on ? 'opacity-100' : 'opacity-0'}`}>▼</span>
      </button>
    </th>
  )
}
