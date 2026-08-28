'use client'

import { matchRange, type RecipientRow, type SortId } from '../shared'
import type { Person } from '@/types'

/* İki alıcı görünümünün paylaştığı küçük parçalar. Görünümler arasında
   tutarlılığı bunlar sağlıyor: aynı vurgulama, aynı aksiyon ikonları, aynı
   "bekleyen" rozeti. */

export interface RecipientViewProps {
  rows: RecipientRow[]
  /** Aktif arama sorgusu — yalnız eşleşen harfleri vurgulamak için. */
  query: string
  onEdit: (person: Person) => void
  onArchive: (person: Person) => void
  /** Aktif sıralama. Araç çubuğundaki seçici ile ortak state; Tablo görünümü
   *  kolon başlıklarından da değiştirebilsin diye görünümlere de geçiliyor. */
  sort: SortId
  onSort: (sort: SortId) => void
}

/** Adın arama ile eşleşen parçasını vurgular. */
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

/** Satır/kart üstündeki düzenle + arşivle. Dokunmatikte hover hiç tetiklenmediği
 *  için `alwaysVisible` ile kalıcı gösterilebilir (ızgara kartları). */
export function RowActions({
  person, onEdit, onArchive, className = '',
}: {
  person: Person
  onEdit: (p: Person) => void
  onArchive: (p: Person) => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); onEdit(person) }}
        title="Düzenle"
        aria-label={`${person.name} düzenle`}
        className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); onArchive(person) }}
        title="Arşivle"
        aria-label={`${person.name} arşivle`}
        className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
      >
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
          <path d="M10 12h4" />
        </svg>
      </button>
    </div>
  )
}

/** Akış dışı (onay bekleyen / tarihi gelmemiş / anapara) bağlı satır sayısı.
 *  Tutarlara girmediği için ayrıca gösterilir — sayı kaybolmuş gibi durmasın. */
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
