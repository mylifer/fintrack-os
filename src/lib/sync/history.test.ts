import { describe, it, expect } from 'vitest'
import { diffRow, actionOf, historyRowFor, safeValue, MAX_VALUE_CHARS } from './history'

/* ────────────────────────────────────────────────────────────────────────
   sync/history — işlem değişiklik geçmişinin SAF diff mantığı

   Geçmiş satırlarını engine'in 5 yazma primitive'i üretir; NE yazıldığına
   karar veren mantık burada ve bu yüzden burada test edilir. İki risk:
   • GÜRÜLTÜ — değişmemiş alan ya da undefined↔null farkı satır üretirse
     her yazma sahte bir "düzenlendi" kaydı bırakır.
   • ŞİŞME — uzun bir not / nesne geçmiş satırını (ve outbox'ı) büyütür.
──────────────────────────────────────────────────────────────────────── */

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', amount: 250, description: 'Market', date: '2026-10-16',
  createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:00:00.000Z',
  ...over,
})

describe('diffRow', () => {
  it('değişmeyen alanı geçmişe KOYMAZ', () => {
    const d = diffRow(row(), row({ amount: 300 }))
    expect(Object.keys(d)).toEqual(['amount'])
    expect(d.amount).toEqual([250, 300])
  })

  it('aynı satırın iki kopyası boş diff verir', () => {
    expect(diffRow(row(), row())).toEqual({})
  })

  it('updatedAt ve user_id yok sayılır (her yazmada değişir / çalışma zamanı alanı)', () => {
    const d = diffRow(
      row({ updatedAt: '2026-10-16T10:00:00.000Z', user_id: 'u1' }),
      row({ updatedAt: '2026-10-16T20:56:00.000Z', user_id: 'u2' }),
    )
    expect(d).toEqual({})
  })

  it('undefined ile null AYNI sayılır (gürültü yapmaz)', () => {
    expect(diffRow(row({ categoryId: undefined }), row({ categoryId: null }))).toEqual({})
    expect(diffRow(row({ categoryId: null }), row())).toEqual({})
  })

  it('gerçekten temizlenen alan diffe girer', () => {
    const d = diffRow(row({ categoryId: 'c1' }), row({ categoryId: null }))
    expect(d.categoryId).toEqual(['c1', null])
  })

  it('dizi ve nesneler DEĞER olarak karşılaştırılır', () => {
    expect(diffRow(row({ tags: ['a', 'b'] }), row({ tags: ['a', 'b'] }))).toEqual({})
    const d = diffRow(row({ tags: ['a'] }), row({ tags: ['a', 'b'] }))
    expect(d.tags).toEqual([['a'], ['a', 'b']])

    const splits = [{ categoryId: 'c1', amount: 10 }]
    expect(diffRow(row({ categorySplits: splits }), row({ categorySplits: [{ categoryId: 'c1', amount: 10 }] }))).toEqual({})
  })

  it('yalnız bir satırda bulunan alan da diffe girer (birleşik anahtar kümesi)', () => {
    const d = diffRow(row(), row({ notes: 'yeni not' }))
    expect(d.notes).toEqual([null, 'yeni not'])
  })

  it('uzun değerler kırpılır (geçmiş satırı şişmesin)', () => {
    const long = 'x'.repeat(MAX_VALUE_CHARS + 50)
    const d = diffRow(row(), row({ notes: long }))
    const next = d.notes[1] as string
    expect(next.length).toBe(MAX_VALUE_CHARS + 1)   // kırpılan + '…'
    expect(next.endsWith('…')).toBe(true)
  })

  it('safeValue sınırın altındaki değere dokunmaz', () => {
    expect(safeValue('kısa')).toBe('kısa')
    expect(safeValue(['a', 'b'])).toEqual(['a', 'b'])
    expect(safeValue(undefined)).toBe(null)
  })
})

describe('actionOf', () => {
  it('prev yok → create', () => {
    expect(actionOf(undefined, row())).toBe('create')
  })

  it('canlı → tombstone = delete', () => {
    expect(actionOf(row(), row({ deleted_at: '2026-10-16T20:56:00.000Z' }))).toBe('delete')
  })

  it('tombstone → canlı = restore', () => {
    expect(actionOf(row({ deleted_at: '2026-10-16T20:56:00.000Z' }), row({ deleted_at: null }))).toBe('restore')
  })

  it('diğer her şey update', () => {
    expect(actionOf(row(), row({ amount: 9 }))).toBe('update')
    // iki tombstone arası düzenleme de silme/geri alma değildir
    expect(actionOf(row({ deleted_at: 'a' }), row({ deleted_at: 'b' }))).toBe('update')
  })
})

describe('historyRowFor', () => {
  const at = '2026-10-16T20:56:00.000Z'

  it('boş diff → null (gürültü satırı yazılmaz)', () => {
    expect(historyRowFor('t1', row(), row(), { source: 'form' }, at, 'h1')).toBe(null)
  })

  it('create eyleminde diff boş olsa bile satır yazılır', () => {
    const entry = historyRowFor('t1', undefined, row(), { source: 'form' }, at, 'h1')
    expect(entry).not.toBe(null)
    expect(entry!.action).toBe('create')
    expect(entry!.id).toBe('h1')
    expect(entry!.txId).toBe('t1')
    expect(entry!.at).toBe(at)
    expect(entry!.source).toBe('form')
    expect(entry!.deleted_at).toBe(null)
  })

  it('düzenleme satırı yalnız değişen alanları taşır', () => {
    const entry = historyRowFor('t1', row(), row({ date: '2026-09-25' }), { source: 'batch' }, at, 'h2')!
    expect(entry.action).toBe('update')
    expect(entry.source).toBe('batch')
    expect(entry.changes).toEqual({ date: ['2026-10-16', '2026-09-25'] })
  })

  it('kaynak verilmezse "app" kalır ve workspaceId satırdan alınır', () => {
    const entry = historyRowFor('t1', row(), row({ amount: 1, workspaceId: 'ws1' }), undefined, at, 'h3')!
    expect(entry.source).toBe('app')
    expect(entry.workspaceId).toBe('ws1')
  })
})
