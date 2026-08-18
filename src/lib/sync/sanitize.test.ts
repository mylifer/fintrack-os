import { describe, it, expect } from 'vitest'
import { sanitizeIdRefs } from './sanitize'

describe('sanitizeIdRefs', () => {
  it("boş kimlik referansını null'a çevirir", () => {
    // Kullanıcının takıldığı satır: borç anaparası "yalnız hedef hesabı olan
    // transfer" olarak yazılmıştı → accountId '' → invalid input syntax for uuid.
    const out = sanitizeIdRefs({
      id: 'tx-1', type: 'transfer', accountId: '', toAccountId: 'acc-9',
    })
    expect(out.accountId).toBeNull()
    expect(out.toAccountId).toBe('acc-9')
  })

  it('tüm kimlik kolonlarını kapsar, yalnız accountId değil', () => {
    const out = sanitizeIdRefs({
      id: 'tx-1',
      accountId: '', toAccountId: '', categoryId: '', debtId: '',
      familyMemberId: '', recipientId: '', parentId: '', workspaceId: '',
      linkedTransactionId: '', refundOfId: '', installGroupId: '',
    })
    for (const [k, v] of Object.entries(out)) {
      if (k === 'id') continue
      expect(v, `${k} temizlenmeliydi`).toBeNull()
    }
  })

  it("birincil anahtar `id`'ye DOKUNMAZ (null olamaz; dead-letter'da görünür kalmalı)", () => {
    const out = sanitizeIdRefs({ id: '', accountId: '' })
    expect(out.id).toBe('')
    expect(out.accountId).toBeNull()
  })

  it('kimlik olmayan boş alanları ve dolu kimlikleri korur', () => {
    const out = sanitizeIdRefs({
      id: 'tx-1', description: '', notes: '', accountId: 'acc-1',
      amount: 0, isInstallment: false, deleted_at: null, icon: undefined,
    })
    expect(out).toEqual({
      id: 'tx-1', description: '', notes: '', accountId: 'acc-1',
      amount: 0, isInstallment: false, deleted_at: null, icon: undefined,
    })
  })

  it('temizlenecek bir şey yoksa aynı nesneyi döndürür (gereksiz kopya yok)', () => {
    const input = { id: 'tx-1', accountId: 'acc-1', categoryId: null }
    expect(sanitizeIdRefs(input)).toBe(input)
  })

  it('girdiyi mutasyona uğratmaz', () => {
    const input = { id: 'tx-1', accountId: '' }
    sanitizeIdRefs(input)
    expect(input.accountId).toBe('')
  })
})
