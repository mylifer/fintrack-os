import { describe, it, expect } from 'vitest'
import { recipientEdit } from './commit'

const cats: Record<string, string> = { migros: 'market', eczane: 'saglik' }
const categoryOf = (id: string) => cats[id]

describe('recipientEdit: alıcı seçilince kategori', () => {
  it('kategoriye dokunulmadıysa alıcının kategorisi gelir', () => {
    expect(recipientEdit(undefined, 'migros', categoryOf)).toEqual({ recipientId: 'migros', categoryId: 'market', categoryAuto: true })
  })
  it('otomatik gelen kategori, başka alıcı seçilince yenilenir', () => {
    expect(recipientEdit({ recipientId: 'migros', categoryId: 'market', categoryAuto: true }, 'eczane', categoryOf))
      .toEqual({ recipientId: 'eczane', categoryId: 'saglik', categoryAuto: true })
  })
  it('elle seçilen kategori korunur', () => {
    expect(recipientEdit({ categoryId: 'giyim', categoryAuto: false }, 'migros', categoryOf)).toEqual({ recipientId: 'migros' })
    expect(recipientEdit({ categoryId: 'giyim' }, 'migros', categoryOf)).toEqual({ recipientId: 'migros' })
  })
  it('geçmişi olmayan alıcı ya da alıcısız seçimde kategori değişmez', () => {
    expect(recipientEdit(undefined, 'yeni', categoryOf)).toEqual({ recipientId: 'yeni' })
    expect(recipientEdit(undefined, null, categoryOf)).toEqual({ recipientId: null })
  })
})
