import { describe, it, expect } from 'vitest'
import { optionForEdit, recipientEdit } from './commit'

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



describe('optionForEdit: karar alıcı düzenlemesine uyar', () => {
  const row = { options: ['create-new', 'create-existing', 'create', 'skip'].map(key => ({ key, label: key, actions: [] })) }
  it('yeni alıcı → Yeni alıcıyla gir', () => {
    expect(optionForEdit(row, { newRecipient: 'Lale Eczanesi' })).toBe(0)
    expect(optionForEdit(row, { recipientId: undefined, newRecipient: 'X' })).toBe(0)
  })
  it('var olan alıcı → Var olan alıcıyla gir', () => {
    expect(optionForEdit(row, { recipientId: 'p1', categoryId: 'c' })).toBe(1)
  })
  it('alıcı kaldırıldı → Alıcısız gir', () => {
    expect(optionForEdit(row, { recipientId: null })).toBe(2)
  })
  it('alıcıya dokunulmadıysa ya da seçenek yoksa karar değişmez', () => {
    expect(optionForEdit(row, { description: 'x' })).toBeNull()
    expect(optionForEdit(row, undefined)).toBeNull()
    expect(optionForEdit({ options: [{ key: 'create', label: 'Gir', actions: [] }] }, { recipientId: 'p1' })).toBeNull()
  })
})
