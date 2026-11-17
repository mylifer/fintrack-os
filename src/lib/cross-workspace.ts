import type { Account, Transaction, Workspace } from '@/types'

/** Alanlar arası transferin bacaklarını (düzenlenen satır + karşı bacakları)
 *  sınıflar: çıkış (gider, kaynak alan), giriş (gelir, hedef alan) ve varsa
 *  hedef alandaki borç ödemesi. Beklenmeyen bir küme (eksik/fazla bacak,
 *  tutarsız alanlar) → boş nesne: düzenleme bu transferi tanımaz. */
export function classifyCrossWsLegs(legs: Transaction[]): { outgoing?: Transaction; incoming?: Transaction; payment?: Transaction } {
  const outs     = legs.filter(t => t.type === 'expense' && !t.debtId)
  const ins      = legs.filter(t => t.type === 'income' && !t.debtId)
  const payments = legs.filter(t => t.type === 'transfer' && !!t.debtId)
  if (outs.length !== 1 || ins.length !== 1 || payments.length > 1
    || outs.length + ins.length + payments.length !== legs.length) return {}
  const [outgoing] = outs, [incoming] = ins, [payment] = payments
  if (outgoing.workspaceId === incoming.workspaceId) return {}
  if (payment && payment.workspaceId !== incoming.workspaceId) return {}
  return { outgoing, incoming, payment }
}

/** Alanlar arası transfer bacağının karşı tarafı: para nereye gitti / nereden geldi. */
export interface CrossWsPeer {
  /** 'out': bu satırdan para çıktı (karşı taraf hedef) · 'in': bu satıra para geldi */
  direction: 'out' | 'in'
  /** Karşı bacağın alanı, hesabı ve satırı — tıklayınca oraya geçilir */
  workspaceId: string | null
  workspaceName: string
  accountId: string
  accountName: string
  account?: Account
  txId: string
}

/** Bacak kümelerinden satır → karşı taraf eşlemesi. Tanınmayan (eksik/bozuk)
 *  kümeler atlanır: o satır sıradan gelir/gider gibi görünmeye devam eder. */
export function resolveCrossWsPeers(
  legs: readonly Transaction[],
  accountsById: ReadonlyMap<string, Account>,
  workspaces: readonly Pick<Workspace, 'id' | 'name'>[],
): Map<string, CrossWsPeer> {
  const groups = new Map<string, Transaction[]>()
  for (const t of legs) {
    if (!t.workspaceTransferId) continue
    const g = groups.get(t.workspaceTransferId)
    if (g) g.push(t)
    else groups.set(t.workspaceTransferId, [t])
  }
  const wsName = (id?: string | null) => workspaces.find(w => w.id === id)?.name ?? 'Başka alan'
  const peerOf = (t: Transaction, direction: 'out' | 'in'): CrossWsPeer => {
    const account = accountsById.get(t.accountId)
    return {
      direction, workspaceId: t.workspaceId ?? null, workspaceName: wsName(t.workspaceId),
      accountId: t.accountId, accountName: account?.name ?? 'Silinmiş hesap', account, txId: t.id,
    }
  }
  const out = new Map<string, CrossWsPeer>()
  for (const group of groups.values()) {
    const { outgoing, incoming, payment } = classifyCrossWsLegs(group)
    if (!outgoing || !incoming) continue
    out.set(outgoing.id, peerOf(incoming, 'out'))
    out.set(incoming.id, peerOf(outgoing, 'in'))
    if (payment) out.set(payment.id, peerOf(outgoing, 'in'))
  }
  return out
}
