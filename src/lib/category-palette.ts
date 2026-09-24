/* ── Kategori renk paleti (yaprak modül) ──────────────────────────────────
   CategoryIcon.tsx yüzlerce ikon bileşeni import eden ağır bir istemci
   bileşeni; paleti oradan almak store'u ve otomatik ikon önericisini o
   ağacın tamamına bağlardı. Bu yüzden palet burada, hiçbir şey import
   etmeyen bir yaprak modülde duruyor. CategoryIcon bunları yeniden
   dışa aktarır, böylece mevcut import noktaları aynen çalışır. */

/* Otomatik ikon önericisinin (category-icon-suggest) karma yedeği bu 16
   renge bağlı: aynı ad her zaman aynı rengi almalı (yedek geri yükleme ve
   tekrar çalışan geçişler sonucu değiştirmesin). Bu yüzden bu dizi
   DONDURULMUŞTUR — yeni renkler buraya değil, COLOR_PALETTE_GROUPS'a eklenir. */
export const SUGGEST_PALETTE = [
  '#6366F1', '#3B82F6', '#0EA5E9', '#06B6D4',
  '#10B981', '#84CC16', '#EAB308', '#F97316',
  '#EF4444', '#EC4899', '#A855F7', '#8B5CF6',
  '#6B8F80', '#78716C', '#0F766E', '#1D4ED8',
] as const

/* Seçicide gösterilen renkler; her grup 10'luk satırlara dizilir ve renk
   çemberi sırasını izler. İkon rengin ÜSTÜNE beyaz çizildiği için açık /
   pastel ton yok — beyaz ikon onların üstünde okunmaz. */
export const COLOR_PALETTE_GROUPS: ReadonlyArray<{ label: string; colors: readonly string[] }> = [
  { label: 'Canlı', colors: [
    '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
    '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#64748B', '#6B7280', '#78716C',
  ] },
  { label: 'Koyu', colors: [
    '#B91C1C', '#C2410C', '#B45309', '#A16207', '#4D7C0F', '#15803D', '#047857', '#0F766E', '#0E7490', '#0369A1',
    '#1D4ED8', '#4338CA', '#6D28D9', '#7E22CE', '#A21CAF', '#BE185D', '#BE123C', '#334155', '#374151', '#44403C',
  ] },
  { label: 'Derin', colors: [
    '#6B8F80', '#7F1D1D', '#7C2D12', '#713F12', '#365314', '#14532D', '#164E63', '#1E3A8A', '#581C87', '#831843',
  ] },
]

export const COLOR_PALETTE: readonly string[] = COLOR_PALETTE_GROUPS.flatMap(g => g.colors)

export const DEFAULT_ICON  = 'package'
export const DEFAULT_COLOR = '#6366F1'
