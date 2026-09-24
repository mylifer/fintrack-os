/* ── Anlamsal renk düzeni — varsayılan listede OLMAYAN kategoriler ─────────
   Sistem kategorilerinin rengi DEFAULT_CATEGORIES'ten gelir (initDefaults
   Faz 3 her açılışta eşitler). Kullanıcının eklediği ve listeden çıkmış eski
   sistem kategorileri (Eğitim, Yemek Dışarı) o eşitlemeye girmez; onların
   renkleri burada, aynı kurala göre: üst kategori benzersiz bir renk, alt
   kategori üst kategorinin renk ailesinden bir ton. Palette karşılığı
   olmayan 600/800 tonları (işaretli) bir ailede ton kalmadığı için özel.

   categories.store'daki tek seferlik geçiş bu haritayı çalışma alanı başına
   bir kez uygular. Buraya bir DEFAULT_CATEGORIES adı EKLENMEMELİ — Faz 3 onu
   bir sonraki açılışta geri alırdı (test bunu denetliyor). */

import type { Category, CategoryScope } from '@/types'

export const RECOLOR_BY_NAME: Record<CategoryScope, Readonly<Record<string, string>>> = {
  expense: {
    'Eğitim':        '#6366F1',   // çivit — akademik
    'Pets':          '#84CC16',   // açık yeşil — doğa
    'Businesswise':  '#334155',   // koyu arduvaz — kurumsal
    'Hibe':          '#A855F7',   // mor — bağış
    'Yemek Dışarı':  '#C2410C',   // Yemek (turuncu) ailesi
    'Gift':          '#DB2777',   // Alışveriş (pembe) ailesi — özel: pembe-600
    'Kozmetik':      '#BE123C',   // Kişisel Bakım (gül) ailesi
    'Night Life':    '#581C87',   // Eğlence (fuşya) ailesi — gece moru
    'Dekor':         '#D97706',   // Ev (kehribar) ailesi — özel: kehribar-600
    'Araç Kiralama': '#2563EB',   // Ulaşım (mavi) ailesi — özel: mavi-600
    'Araç Aksesuar': '#1E40AF',   // Ulaşım (mavi) ailesi — özel: mavi-800
  },
  income: {
    'Satış':         '#15803D',   // gelir (yeşil) ailesi
    'İade':          '#0F766E',   // gelir ailesi — geri gelen para
  },
}

/** Geçişte bu kategoriye yazılacak renk; değişiklik gerekmiyorsa null. */
export function recolorPatch(cat: Pick<Category, 'name' | 'scope' | 'color' | 'isArchived'>): { color: string } | null {
  if (cat.isArchived) return null
  const color = RECOLOR_BY_NAME[cat.scope]?.[cat.name]
  return color && color !== cat.color ? { color } : null
}
