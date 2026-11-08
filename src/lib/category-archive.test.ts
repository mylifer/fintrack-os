import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Category } from '@/types'
import {
  archivableSubtreeIds, restorableSubtreeIds,
  saveArchiveGroup, loadArchiveGroup, clearArchiveGroup,
} from './category-archive'

const cat = (id: string, parentId?: string, isArchived = false): Category => ({
  id, name: id, icon: 'package', color: '#000', scope: 'expense', parentId, isSystem: false, sortOrder: 0, isArchived,
})

describe('archivableSubtreeIds — yalnız aktif torunlar', () => {
  it('daha önce arşivlenmiş alt kategoriyi kaydetmez; yapraklardan köke sıralar', () => {
    const cats = [cat('p'), cat('a', 'p'), cat('old', 'p', true), cat('a1', 'a')]
    const ids = archivableSubtreeIds('p', cats)
    expect(ids).not.toContain('old')
    expect(new Set(ids)).toEqual(new Set(['p', 'a', 'a1']))
    expect(ids[ids.length - 1]).toBe('p')
    expect(ids.indexOf('a1')).toBeLessThan(ids.indexOf('a'))
  })

  it('onay sayısı = aktif torun sayısı', () => {
    const cats = [cat('p'), cat('a', 'p'), cat('old', 'p', true)]
    expect(archivableSubtreeIds('p', cats).length - 1).toBe(1)
  })
})

describe('restorableSubtreeIds', () => {
  // p arşivlendi (a ile birlikte); old daha önce ayrıca arşivlenmişti
  const cats = [cat('p', undefined, true), cat('a', 'p', true), cat('old', 'p', true)]

  it('grup biliniyorsa yalnız birlikte arşivlenenleri geri getirir', () => {
    expect(restorableSubtreeIds('p', cats, ['a', 'p'])).toEqual(['p', 'a'])
  })

  it('grup yoksa arşivli alt ağacın tamamına düşer', () => {
    expect(restorableSubtreeIds('p', cats, null)).toEqual(['p', 'a', 'old'])
  })
})

describe('arşiv grubu kaydı (localStorage)', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => { store.set(k, v) },
        },
      },
    })
  })

  afterEach(() => { delete (globalThis as { window?: unknown }).window })

  it('kaydeder, okur ve siler', () => {
    expect(loadArchiveGroup('p')).toBeNull()
    saveArchiveGroup('p', ['a', 'p'])
    expect(loadArchiveGroup('p')).toEqual(['a', 'p'])
    clearArchiveGroup('p')
    expect(loadArchiveGroup('p')).toBeNull()
  })
})
