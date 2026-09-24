/* ── Kategori renk paleti (yaprak modül) ──────────────────────────────────
   CategoryIcon.tsx yüzlerce ikon bileşeni import eden ağır bir istemci
   bileşeni; paleti oradan almak store'u ve otomatik ikon önericisini o
   ağacın tamamına bağlardı. Bu yüzden palet burada, hiçbir şey import
   etmeyen bir yaprak modülde duruyor. CategoryIcon bunları yeniden
   dışa aktarır, böylece mevcut import noktaları aynen çalışır. */

export const COLOR_PALETTE = [
  '#6366F1', '#3B82F6', '#0EA5E9', '#06B6D4',
  '#10B981', '#84CC16', '#EAB308', '#F97316',
  '#EF4444', '#EC4899', '#A855F7', '#8B5CF6',
  '#6B8F80', '#78716C', '#0F766E', '#1D4ED8',
]

export const DEFAULT_ICON  = 'package'
export const DEFAULT_COLOR = '#6366F1'
