import { describe, it, expect } from 'vitest'
import { DEFAULT_CATEGORIES, type CategoryScope } from '@/types'
import { RECOLOR_BY_NAME, recolorPatch } from './category-recolor'

/* ────────────────────────────────────────────────────────────────────────
   Anlamsal renk düzeni — kurallar

   · Her üst kategori kendi kapsamında BENZERSİZ bir renk alır.
   · Alt kategoriler kardeşlerinden ve üst kategorilerinden farklıdır.
   · Varsayılan listede olmayan kategorilerin haritası (RECOLOR_BY_NAME)
     varsayılan adları içermez — Faz 3 onları her açılışta geri alırdı.
──────────────────────────────────────────────────────────────────────── */

const byScope = (scope: CategoryScope) => DEFAULT_CATEGORIES.filter(d => d.scope === scope)

describe('DEFAULT_CATEGORIES renk düzeni', () => {
  it.each(['expense', 'income'] as const)('%s: üst kategori renkleri benzersiz', scope => {
    const tops = byScope(scope).filter(d => !d._parentName).map(d => d.color)
    expect(new Set(tops).size).toBe(tops.length)
  })

  it('alt kategoriler kardeşlerinden ve üst kategorilerinden farklı', () => {
    const parents = new Map(byScope('expense').filter(d => !d._parentName).map(d => [d.name, d.color]))
    const siblings = new Map<string, string[]>()
    for (const d of byScope('expense').filter(d => d._parentName)) {
      expect(d.color, `${d.name} üst kategorisiyle aynı`).not.toBe(parents.get(d._parentName!))
      siblings.set(d._parentName!, [...(siblings.get(d._parentName!) ?? []), d.color])
    }
    for (const [parent, colors] of siblings) {
      expect(new Set(colors).size, `${parent} altında tekrar eden renk`).toBe(colors.length)
    }
  })
})

describe('RECOLOR_BY_NAME', () => {
  it('varsayılan listedeki hiçbir adı içermez', () => {
    for (const scope of ['expense', 'income'] as const) {
      const defaults = new Set(byScope(scope).map(d => d.name))
      for (const name of Object.keys(RECOLOR_BY_NAME[scope])) expect(defaults.has(name), name).toBe(false)
    }
  })

  it('renkler geçerli, kendi içinde tekrarsız ve hiçbir varsayılan gider rengiyle çakışmıyor', () => {
    const colors = Object.values(RECOLOR_BY_NAME.expense)
    for (const c of colors) expect(c).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(colors).size).toBe(colors.length)
    const taken = new Set(byScope('expense').map(d => d.color))
    for (const c of colors) expect(taken.has(c), c).toBe(false)
  })
})

describe('recolorPatch', () => {
  const cat = { name: 'Pets', scope: 'expense' as const, color: '#FF0000', isArchived: false }

  it('haritadaki ada yeni rengini yazar', () => {
    expect(recolorPatch(cat)).toEqual({ color: '#84CC16' })
  })

  it('renk zaten doğruysa, kategori arşivliyse ya da ad haritada yoksa dokunmaz', () => {
    expect(recolorPatch({ ...cat, color: '#84CC16' })).toBeNull()
    expect(recolorPatch({ ...cat, isArchived: true })).toBeNull()
    expect(recolorPatch({ ...cat, name: 'Market' })).toBeNull()
    expect(recolorPatch({ ...cat, scope: 'income' })).toBeNull()   // kapsam da eşleşmeli
  })
})
