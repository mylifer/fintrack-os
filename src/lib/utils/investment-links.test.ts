import { describe, it, expect } from 'vitest'
import { sellCleanupTxIds } from './investment-links'
import type { Transaction } from '@/types'

type Candidate = Pick<Transaction, 'id' | 'type' | 'accountId' | 'date' | 'description'>

const ACC  = 'acc-1'
const DATE = '2026-07-15'

function tx(partial: Partial<Candidate> & { id: string }): Candidate {
  return { type: 'income', accountId: ACC, date: DATE, description: '', ...partial }
}

describe('sellCleanupTxIds', () => {
  it('targetAccountId yoksa hiçbir şey silinmez', () => {
    expect(sellCleanupTxIds(
      { targetAccountId: undefined, date: DATE, linkedTransactionId: 'sale-1' },
      'Gr Altın', [],
    )).toEqual([])
  })

  it('iki ID bağı da varsa yalnız o iki kaydı hedefler — aynı gün ikinci satışın kayıtlarına dokunmaz', () => {
    const ledger = [
      tx({ id: 'sale-1', description: '5 Gr Altın Satışı' }),
      tx({ id: 'pnl-1',  description: 'Gr Altın Satış Kârı' }),
      // Aynı gün, aynı varlıktan ikinci satışın kayıtları — silinmemeli
      tx({ id: 'sale-2', description: '3 Gr Altın Satışı' }),
      tx({ id: 'pnl-2',  description: 'Gr Altın Satış Kârı' }),
    ]
    const ids = sellCleanupTxIds(
      { targetAccountId: ACC, date: DATE, linkedTransactionId: 'sale-1', pnlLinkedTransactionId: 'pnl-1' },
      'Gr Altın', ledger,
    )
    expect(ids).toEqual(['sale-1', 'pnl-1'])
  })

  it('P&L kaydı store listesinde görünmese bile ID bağıyla hedeflenir', () => {
    const ids = sellCleanupTxIds(
      { targetAccountId: ACC, date: DATE, linkedTransactionId: 'sale-1', pnlLinkedTransactionId: 'pnl-1' },
      'Gr Altın', [],
    )
    expect(ids).toEqual(['sale-1', 'pnl-1'])
  })

  it('legacy satır (pnl ID yok): P&L açıklama+tarih eşleşmesiyle bulunur', () => {
    const ledger = [
      tx({ id: 'sale-1', description: '5 Gr Altın Satışı' }),
      tx({ id: 'pnl-1',  description: 'Gr Altın Satış Zararı', type: 'expense' }),
      tx({ id: 'other',  description: 'Gr Altın Satış Zararı', type: 'expense', date: '2026-07-14' }),
    ]
    const ids = sellCleanupTxIds(
      { targetAccountId: ACC, date: DATE, linkedTransactionId: 'sale-1' },
      'Gr Altın', ledger,
    )
    expect(ids).toEqual(['sale-1', 'pnl-1'])
  })

  it('legacy satır: eşleşen P&L yoksa yalnız satış kaydı hedeflenir', () => {
    const ids = sellCleanupTxIds(
      { targetAccountId: ACC, date: DATE, linkedTransactionId: 'sale-1' },
      'Gr Altın', [tx({ id: 'sale-1', description: '5 Gr Altın Satışı' })],
    )
    expect(ids).toEqual(['sale-1'])
  })

  it('en eski satırlar (hiç ID bağı yok): açıklama+tarih eşleşmesi, transfer hariç', () => {
    const ledger = [
      tx({ id: 'sale-1', description: '5 Gr Altın Satışı' }),
      tx({ id: 'pnl-1',  description: 'Gr Altın Satış Kârı' }),
      tx({ id: 'buy-1',  description: '2 Gr Altın Alımı', type: 'expense' }),
      tx({ id: 'tr-1',   description: 'Gr Altın Satışı', type: 'transfer' }),
      tx({ id: 'other-acc', description: '5 Gr Altın Satışı', accountId: 'acc-2' }),
    ]
    const ids = sellCleanupTxIds(
      { targetAccountId: ACC, date: DATE, linkedTransactionId: undefined },
      'Gr Altın', ledger,
    )
    expect(ids).toEqual(['sale-1', 'pnl-1'])
  })
})
