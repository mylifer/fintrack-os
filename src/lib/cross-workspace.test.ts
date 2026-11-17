import { describe, it, expect } from 'vitest'
import { resolveCrossWsPeers } from '@/lib/cross-workspace'
import type { Account, Transaction } from '@/types'

const tx = (p: Partial<Transaction>): Transaction => ({
  id: 'x', type: 'expense', amount: 4146.64, currency: 'TRY', date: '2026-09-28', accountId: 'a', description: 'Kredi Kartı Ödemesi',
  createdAt: '', ...p,
} as Transaction)
const acc = (id: string, name: string) => ({ id, name } as Account)
const accounts = new Map([['odea', acc('odea', 'Odeabank')], ['yk', acc('yk', 'Yapı Kredi Platinum')]])
const workspaces = [{ id: 'wsD', name: 'Damla' }, { id: 'wsK', name: 'Kaan' }]

describe('resolveCrossWsPeers', () => {
  it('çıkış bacağı hedefi, giriş bacağı kaynağı gösterir', () => {
    const out = tx({ id: 'o', type: 'expense', accountId: 'odea', workspaceId: 'wsD', workspaceTransferId: 'L' })
    const inc = tx({ id: 'i', type: 'income', accountId: 'yk', workspaceId: 'wsK', workspaceTransferId: 'L' })
    const m = resolveCrossWsPeers([out, inc], accounts, workspaces)
    expect(m.get('o')).toMatchObject({ direction: 'out', workspaceName: 'Kaan', accountName: 'Yapı Kredi Platinum' })
    expect(m.get('i')).toMatchObject({ direction: 'in', workspaceName: 'Damla', accountName: 'Odeabank' })
  })

  it('eksik bacaklı küme tanınmaz', () => {
    const out = tx({ id: 'o', accountId: 'odea', workspaceId: 'wsD', workspaceTransferId: 'L' })
    expect(resolveCrossWsPeers([out], accounts, workspaces).size).toBe(0)
  })
})
