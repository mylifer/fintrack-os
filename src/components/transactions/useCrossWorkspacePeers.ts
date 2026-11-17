'use client'

import { useEffect, useMemo, useState } from 'react'
import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { resolveCrossWsPeers, type CrossWsPeer } from '@/lib/cross-workspace'
import { useWorkspaceStore } from '@/store/workspace.store'
import type { Account, Transaction } from '@/types'

export type { CrossWsPeer }

/** Listede görünen alanlar arası transfer bacaklarının karşı taraflarını ham
 *  Dexie'den okur — karşı alan (hesapları ve satırları) store'a yüklü değildir. */
export function useCrossWorkspacePeers(transactions: readonly Transaction[]): Map<string, CrossWsPeer> {
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const linkKey = useMemo(
    () => [...new Set(transactions.flatMap(t => (t.workspaceTransferId ? [t.workspaceTransferId] : [])))].sort().join(','),
    [transactions],
  )
  const [state, setState] = useState<{ key: string; legs: Transaction[]; accounts: Map<string, Account> } | null>(null)

  useEffect(() => {
    if (!linkKey) return
    let cancelled = false
    ;(async () => {
      const rows = (await db.transactions.where('workspaceTransferId').anyOf(linkKey.split(',')).toArray() as Transaction[]).filter(isLive)
      const accIds = [...new Set(rows.map(t => t.accountId))]
      const accs = (await db.accounts.bulkGet(accIds)) as (Account | undefined)[]
      if (cancelled) return
      setState({ key: linkKey, legs: rows, accounts: new Map(accs.flatMap(a => (a ? [[a.id, a] as const] : []))) })
    })().catch(() => {})
    return () => { cancelled = true }
  }, [linkKey, transactions])

  return useMemo(
    () => (state && linkKey && state.key === linkKey ? resolveCrossWsPeers(state.legs, state.accounts, workspaces) : new Map<string, CrossWsPeer>()),
    [state, linkKey, workspaces],
  )
}
