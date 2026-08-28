'use client'

import type { BoardConfig, PersonRow, SortId } from '../shared'

/* Kişi görünümlerinin ortak prop sözleşmesi. Görsel parçalar (Highlight,
   RowActions, PendingBadge, netTone, SortTh) tüm tahta sayfalarıyla ortak:
   bkz. @/components/ui/BoardBits. */

export interface PersonViewProps {
  rows: PersonRow[]
  /** Aktif varyant (alıcı / aile üyesi) — para kolonlarını ve linkleri belirler. */
  config: BoardConfig
  /** Aktif arama sorgusu — yalnız eşleşen harfleri vurgulamak için. */
  query: string
  onEdit: (person: PersonRow['person']) => void
  onArchive: (person: PersonRow['person']) => void
  /** Aktif sıralama. Araç çubuğundaki seçici ile ortak state; Tablo görünümü
   *  kolon başlıklarından da değiştirebilsin diye görünümlere de geçiliyor. */
  sort: SortId
  onSort: (sort: SortId) => void
}
