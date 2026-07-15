import type { Category } from '@/types'

/** Türkçe alfabetik kategori sıralaması (ç, ğ, ı/İ, ö, ş, ü doğru konumlanır). */
export const compareCategoriesByName = (a: Category, b: Category) =>
  a.name.localeCompare(b.name, 'tr')
