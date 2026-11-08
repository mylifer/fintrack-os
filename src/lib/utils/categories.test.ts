import { describe, it, expect } from 'vitest'
import type { Category } from '@/types'
import { categorySubtreeHeight } from './categories'

const cat = (id: string, parentId?: string): Category => ({
  id, name: id, icon: 'package', color: '#000', scope: 'expense', parentId, isSystem: false, sortOrder: 0,
})

describe('categorySubtreeHeight — taşıma derinlik koruması', () => {
  const cats = [cat('a'), cat('b', 'a'), cat('c', 'b'), cat('d'), cat('e', 'd')]

  it('yaprak → 0, çocuğu var → 1, torunu var → 2', () => {
    expect(categorySubtreeHeight('c', cats)).toBe(0)
    expect(categorySubtreeHeight('b', cats)).toBe(1)
    expect(categorySubtreeHeight('a', cats)).toBe(2)
    expect(categorySubtreeHeight('d', cats)).toBe(1)
  })

  it('çocuklu 1. seviye kategori başka bir 1. seviyenin altına taşınamaz (4. seviye olurdu)', () => {
    // b seviye 1, yüksekliği 1: yeni üst seviye-1 → yeni seviye 2, 2 + 1 > 2
    expect(2 + categorySubtreeHeight('b', cats) > 2).toBe(true)
    // seviye-0 bir üst kategori altına taşımak serbest: 1 + 1 ≤ 2
    expect(1 + categorySubtreeHeight('b', cats) > 2).toBe(false)
  })

  it('döngülü veride sonsuz özyinelemeye girmez', () => {
    const loop = [cat('x', 'y'), cat('y', 'x')]
    expect(() => categorySubtreeHeight('x', loop)).not.toThrow()
  })
})
