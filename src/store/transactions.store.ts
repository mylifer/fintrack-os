'use client'

import { create } from 'zustand'
import { db } from '@/lib/db'
import type { Account, CategorySplit, Debt, Transaction, TransactionFilters, TxHistorySource } from '@/types'
import { isInRange, today } from '@/lib/utils/date'
import { addMonths, format, parseISO } from 'date-fns'
import { useAccountStore } from './accounts.store'
import { useDebtStore, debtPaymentPatches } from './debts.store'
import { usePeopleStore } from './people.store'
import { useCategoryStore } from './categories.store'
import { makeTxSearchMatcher } from '@/lib/utils/txSearch'
import { useUndoStore, type RemoveOptions } from './undo.store'
import { isLive } from '@/lib/sync/tombstone'
import { localUpsert, localBulkUpsert, localPatch, softDeleteMany, reconcilingPull, localBatch, type BatchOp } from '@/lib/sync/engine'
import { rowInActiveWorkspace, rowInWorkspace } from '@/lib/workspace-context'
import { useWorkspaceStore } from './workspace.store'
import { toBaseTry, fromBaseTry, baseAmount, baseSnapshot } from '@/lib/utils/fx'
import { txTouchesAccount } from '@/lib/utils/calculations'
import { splitInstallments, mulMoney, toMinor } from '@/lib/utils/money'
import { findInstallmentRoundingFixes, findInstallmentSplitFixes, groupCategorySplits } from '@/lib/utils/installments'
import { splitsAreValid, splitsMatchAmount, primarySplitCategoryId, rescaleSplits, splitsForInstallments, txHasCategory } from '@/lib/utils/categorySplits'
import { tagKey, normalizeTag, dedupeTags } from '@/lib/utils/tags'
import { withLinkedInterestTax } from '@/lib/utils/interest-tax'

// Snapshot the base-currency (TRY) value at write time (S2/S3). Every creation
// path funnels through the store, so stamping here covers the form, refunds,
// reconciliation ghosts, investment-linked txs and recurring generation.
// If the FX rate isn't available yet (foreign tx created before prices load),
// leave amountTry UNSET rather than stamping a wrong raw value — baseAmount()
// then converts it live once rates arrive (L3). TRY always has a rate (1).
function withBase(tx: Transaction): Transaction {
  const snap = baseSnapshot(tx.amount, tx.currency)
  return snap === null ? tx : { ...tx, amountTry: snap }
}

// Çoklu kategori değişmezini tek noktadan uygular: paylar geçerliyse (2+ pay,
// hepsinin kategorisi dolu, toplam tutara tam eşit) `categoryId` EN BÜYÜK payla
// damgalanır; geçersiz/tek paysa alan tamamen düşer ve işlem sıradan tek
// kategorili satır olarak yaşar. Böylece "bölünmüş ama toplamı tutmayan" satır
// hiçbir yazma yolundan içeri sızamaz (form dışından gelen import/refund dahil).
function splitsEqual(a: readonly CategorySplit[] | undefined, b: readonly CategorySplit[] | undefined): boolean {
  if (!a || !b) return a === b
  return a.length === b.length && a.every((s, i) => s.categoryId === b[i].categoryId && toMinor(s.amount) === toMinor(b[i].amount))
}

function withSplits(tx: Transaction): Transaction {
  const splits = tx.categorySplits
  if (!splitsAreValid(splits, tx.amount)) {
    if (splits === undefined) return tx
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { categorySplits: _drop, ...rest } = tx
    return rest as Transaction
  }
  return { ...tx, categoryId: primarySplitCategoryId(splits) ?? tx.categoryId }
}

// Onay kapısı (bildirim merkezi): gelecek tarihli YENİ işlemler 'pending' doğar —
// tarihi gelince otomatik post olmaz, bildirim merkezinde onay bekler. Çağıran
// approvalStatus'u açıkça verdiyse (örn. tekrarlayan üretimi 'approved' yazar)
// dokunulmaz. Mevcut satırlar bu yoldan geçmez; null/undefined = legacy davranış.
function withApproval(tx: Transaction): Transaction {
  if (tx.approvalStatus !== undefined) return tx
  if (tx.date.slice(0, 10) > today()) return { ...tx, approvalStatus: 'pending' }
  return tx
}

function investRank(tx: Transaction): number {
  if (!tx.icon) return 10
  if (tx.description.includes('Alım')) return 0
  if (tx.description.includes('Kâr') || tx.description.includes('Zarar')) return 6
  return 5
}

// Silinen satır(lar) çalışma alanları arası bir transferin bacağıysa, karşı
// bacak(lar)ı ham Dexie'den bulur. Sıradan transferde tek karşı bacak vardır ve
// başka alana aittir (bu store'da YÜKLÜ DEĞİL). Borç ödemeli transferde üç
// bacak vardır (kaynak gider + hedef giriş + hedef borç ödemesi): hedef alanın
// iki bacağı aktif alandaysa bellekte de bulunur — çağıran onları da düşürür.
async function findTransferPeers(group: Transaction[]): Promise<Transaction[]> {
  const seen = new Set(group.map(t => t.id))
  const linkIds = new Set(group.flatMap(t => (t.workspaceTransferId ? [t.workspaceTransferId] : [])))
  const peers: Transaction[] = []
  for (const linkId of linkIds) {
    const rows = await db.transactions.where('workspaceTransferId').equals(linkId).toArray()
    for (const p of rows) {
      if (seen.has(p.id) || !isLive(p)) continue
      seen.add(p.id)
      peers.push(p)
    }
  }
  return peers
}

/** Satırları (ve karşı bacaklarını) tombstone'lar ya da geri getirir; bağlı
 *  borç ödemelerini geri alır ya da yeniden uygular — HEPSİ tek IndexedDB
 *  işleminde (denetim #22). Eskiden her satır ve her borç ayrı yazılıyordu:
 *  araya giren bir sekme kapanışı taksit grubunun bir kısmını silinmiş, borcu
 *  yarı geri alınmış bırakabiliyordu. Borç tutarı TRY tabanlıdır (baseAmount). */
async function setDeletedWithDebts(
  group: Transaction[], peers: Transaction[], deleted: boolean, source: TxHistorySource = 'form',
): Promise<void> {
  // Karşı bacaklar da borç ödemesi taşıyabilir (alanlar arası borç ödemesi):
  // borç başka alandaysa bellekte yoktur → debtPaymentPatches Dexie'den okur.
  const patches = await debtPaymentPatches(
    [...group, ...peers].filter(t => t.debtId).map(t => ({ debtId: t.debtId!, amount: baseAmount(t) })),
    deleted ? -1 : 1,
  )
  await localBatch([
    {
      kind: 'patchMany', table: 'transactions',
      ids: [...group.map(t => t.id), ...peers.map(t => t.id)],
      patch: { deleted_at: deleted ? new Date().toISOString() : null },
    },
    ...[...patches].map(([id, patch]): BatchOp => ({ kind: 'patch', table: 'debts', id, patch })),
  ], { source })
  useDebtStore.getState().applyLocal(patches)
}

/** Silinen grup + karşı bacakları bellekteki listeden düşürür. `removed`,
 *  bellekte bulunan karşı bacaklardır (undo onları geri ekler). */
function dropRemoved(all: Transaction[], group: Transaction[], peers: Transaction[]) {
  const groupIds = new Set(group.map(t => t.id))
  const peerIds = new Set(peers.map(t => t.id))
  const removed = all.filter(t => peerIds.has(t.id))
  const remaining = all.filter(t => !groupIds.has(t.id) && !peerIds.has(t.id))
  return { removed, remaining }
}

function txSortComparator(a: Transaction, b: Transaction): number {
  const d = b.date.localeCompare(a.date)
  if (d !== 0) return d
  const ca = b.createdAt.localeCompare(a.createdAt)
  if (ca !== 0) return ca
  return investRank(a) - investRank(b)
}

export interface CrossWorkspaceTransferInput {
  sourceAccountId: string
  targetWorkspaceId: string
  targetAccountId: string
  amount: number            // Kaynak hesabın para biriminde
  date: string
  description: string
  notes?: string
  /** Verilirse para hedef alandaki bu borcu öder: hedef hesaba giriş + aynı
   *  hesaptan borç ödemesi (hedef hesabın bakiyesi net değişmez). */
  targetDebtId?: string
}

/** Düzenleme girdisi: transfer, çıkış ya da giriş bacağından düzenlenebilir.
 *  Çıkıştan düzenlenirken kaynak alan aktif alandır (varsayılan); girişten
 *  düzenlenirken kaynak diğer alandır ve hedef aktif alandır. */
export interface CrossWorkspaceTransferEdit extends CrossWorkspaceTransferInput {
  /** Kaynak hesabın alanı (varsayılan: aktif alan). */
  sourceWorkspaceId?: string
  /** `amount` hangi hesabın para biriminde (varsayılan: kaynak). */
  amountIn?: 'source' | 'target'
}

/** Alanlar arası transfer bacaklarını işaretleyen ikon — kategori analizlerinden
 *  hariç tutulsun diye (bkz. addCrossWorkspaceTransfer). */
const CROSS_WS_ICON = '⇄'

/** Alanlar arası transferi düzenlerken karşı bacak(lar): satırın kendisi hariç,
 *  aynı workspaceTransferId'li canlı satırlar (ham Dexie — karşı alan yüklü değil). */
export async function crossWorkspacePeers(tx: Pick<Transaction, 'id' | 'workspaceTransferId'>): Promise<Transaction[]> {
  if (!tx.workspaceTransferId) return []
  const rows = await db.transactions.where('workspaceTransferId').equals(tx.workspaceTransferId).toArray()
  return (rows as Transaction[]).filter(p => p.id !== tx.id && isLive(p))
}

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

/** Borç ödemesi düzenlenirken borç yamaları: önce eski ödeme geri alınır (−1),
 *  yeni ödeme geri alınmış durumun ÜZERİNE uygulanır (+1). Aynı borçta taksit
 *  sayısı net değişmez, yalnız tutar farkı yansır. */
async function debtEditPatches(
  oldPay: { debtId: string; amount: number } | undefined,
  newPay: { debtId: string; amount: number } | undefined,
): Promise<Map<string, Partial<Debt>>> {
  const out = oldPay ? await debtPaymentPatches([oldPay], -1) : new Map<string, Partial<Debt>>()
  if (!newPay) return out
  const current = useDebtStore.getState().debts.find(d => d.id === newPay.debtId) ?? await db.debts.get(newPay.debtId)
  if (!current) return out
  const base = { ...current, ...(out.get(newPay.debtId) ?? {}) } as Debt
  // recordPayment/paymentPatches(+1) ile aynı aritmetik, geri alınmış durumun üstüne.
  const paidAmount = Math.round((base.paidAmount + newPay.amount) * 100) / 100
  const step = newPay.amount > 0 ? 1 : newPay.amount < 0 ? -1 : 0
  const paidInstallments = Math.max(0, (base.paidInstallments ?? 0) + step)
  out.set(newPay.debtId, { paidAmount, paidInstallments, isSettled: paidAmount >= base.totalAmount })
  return out
}

/** Bir hesabı (aktif alandaysa bellekten, değilse ham Dexie'den) okur ve
 *  verilen alana ait olduğunu doğrular. */
async function crossWsAccount(id: string, workspaceId: string): Promise<Account | undefined> {
  const mem = useAccountStore.getState().accounts.find(a => a.id === id)
  const acc = mem ?? (await db.accounts.get(id) as Account | undefined)
  return acc && isLive(acc) && rowInWorkspace(acc, workspaceId) ? acc : undefined
}

/** Kaynak/hedef hesabı doğrular ve karşı tutarı (gerekirse FX ile) hesaplar —
 *  ekleme ve düzenleme aynı kuralı kullanır. Tutar kaynak ya da hedef para
 *  biriminde verilebilir (giriş bacağından düzenleme hedef tutarı girer). */
async function resolveCrossWorkspaceAmounts(
  input: CrossWorkspaceTransferInput, sourceWorkspaceId: string, amountIn: 'source' | 'target' = 'source',
) {
  const sourceAccount = await crossWsAccount(input.sourceAccountId, sourceWorkspaceId)
  if (!sourceAccount) throw new Error('Kaynak hesap bulunamadı')
  const targetAccount = await crossWsAccount(input.targetAccountId, input.targetWorkspaceId)
  if (!targetAccount) throw new Error('Hedef hesap bulunamadı')

  const sourceCurrency = sourceAccount.currency
  const targetCurrency = targetAccount.currency
  // Karşı tutar kur yokken ham fallback'e düşebilir (transfer ANINDA donar,
  // sonradan düzeltilemez). KALICI snapshot ise baseSnapshot'tan gelir: kur
  // yoksa damgalanmaz, böylece baseAmount() kurlar gelince canlı çevirir
  // (withBase/update ile aynı kural — yanlış ham değer kalıcılaşmasın).
  const givenCurrency = amountIn === 'target' ? targetCurrency : sourceCurrency
  const amountTry = toBaseTry(input.amount, givenCurrency)
  const amountTrySnap = baseSnapshot(input.amount, givenCurrency) ?? undefined
  const convert = (to: typeof sourceCurrency) =>
    to === givenCurrency ? input.amount : fromBaseTry(amountTry, to)
  const sourceAmount = convert(sourceCurrency)
  const targetAmount = convert(targetCurrency)
  return { sourceCurrency, targetCurrency, sourceAmount, targetAmount, amountTry, amountTrySnap }
}

interface TransactionState {
  transactions: Transaction[]
  loading: boolean
  ready: boolean
  load: () => Promise<void>
  add: (tx: Transaction, source?: TxHistorySource) => Promise<void>
  addCrossWorkspaceTransfer: (input: CrossWorkspaceTransferInput) => Promise<void>
  /** Kayıtlı bir transferi alanlar arası transfere çevirir ya da var olan
   *  alanlar arası transferin (çıkış bacağı `id`) hedefini/tutarını/tarihini
   *  TÜM bacaklarda birlikte günceller. `targetDebtId` verilirse hedef alandaki
   *  borç ödenir (ödeme bacağı eklenir/güncellenir; borç tutarları eski ödeme
   *  geri alınıp yenisi uygulanarak düzeltilir), verilmezse ödeme bacağı silinir. */
  updateCrossWorkspaceTransfer: (id: string, input: CrossWorkspaceTransferEdit) => Promise<void>
  /** Alanlar arası transferin çıkış bacağını sıradan satıra çevirmeden önce:
   *  karşı bacak(lar)ı siler, bağ alanlarını temizler. */
  detachCrossWorkspaceTransfer: (id: string) => Promise<void>
  /** Üretilen satırların id'lerini taksit sırasıyla döndürür (ilk taksit başta). */
  addInstallmentGroup: (
    base: Omit<Transaction, 'id' | 'installIndex' | 'installGroupId' | 'createdAt' | 'updatedAt'>,
    count: number,
    amounts?: number[],
    source?: TxHistorySource,
  ) => Promise<string[]>
  updateInstallmentGroup: (
    groupId: string,
    shared: Partial<Transaction> & { date: string },
    amounts: number[],
  ) => Promise<void>
  /** Var olan tekil işlemi taksitli gruba dönüştürür (satır 1. taksit olur, id korunur). */
  convertToInstallmentGroup: (
    id: string,
    shared: Partial<Transaction> & { date: string },
    amounts: number[],
  ) => Promise<void>
  /** Eski yuvarlamayla bölünmüş taksit gruplarını banka kuralına çevirir
   *  (kuruş kalanı 1. taksite). Tek undo ile geri alınır. Düzeltilen grup sayısını döner. */
  fixInstallmentRounding: () => Promise<number>
  /** Taksitli + bölünmüş alışverişlerde kuruş kaymış kategori paylarını onarır
   *  (bkz. findInstallmentSplitFixes). Onarılan grup sayısını döner; geri alınabilir. */
  fixInstallmentSplits: () => Promise<number>
  update: (id: string, patch: Partial<Transaction>, source?: TxHistorySource) => Promise<void>
  updateMany: (
    ids: string[],
    patch: Partial<Transaction>,
    opts?: { addTags?: string[] },
    source?: TxHistorySource,
  ) => Promise<void>
  renameTag: (oldTag: string, newTag: string) => Promise<void>
  remove: (id: string, opts?: RemoveOptions, source?: TxHistorySource) => Promise<void>
  removeMany: (ids: string[]) => Promise<void>
  getFiltered: (filters: TransactionFilters, transactions?: Transaction[]) => Transaction[]
}

export const useTransactionStore = create<TransactionState>()((set, get) => ({
  transactions: [],
  loading: false,
  ready: false,

  load: async () => {
    set({ loading: true })
    // Reconciling pull (C2) + pagination (C6): merge the full live cloud set
    // into Dexie without clobbering pending local writes; never truncate.
    try {
      const txs = (await reconcilingPull<Transaction>('transactions')).sort(txSortComparator)
      set({ transactions: txs, loading: false, ready: true })
    } catch (err) {
      console.error('[transactions:load]', err)
      const txs = (await db.transactions.toArray()).filter(isLive).filter(rowInActiveWorkspace).sort(txSortComparator)
      set({ transactions: txs, loading: false, ready: true })
    }
  },

  add: async (tx, source = 'form') => {
    // Base-currency snapshot (S2/S3) + onay kapısı + çoklu kategori değişmezi
    // + durable write (C1).
    const stamped = withSplits(withApproval(withBase(tx)))
    await localUpsert('transactions', stamped, { source })
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = [stamped, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  // Çalışma alanları arası transfer (S1): kaynak alanda 'expense', hedef
  // alanda 'income' olarak iki bağımsız satır, ortak workspaceTransferId ile
  // eşleştirilir (bkz. yatırım al/sat linked-transaction deseni,
  // investment.store.ts — farkla: burada ATOMİK tek localBatch kullanılır).
  // Hedef hesap aktif alanda YÜKLENMEMİŞ olabileceğinden ham Dexie'den okunur.
  // Para birimleri farklıysa hedef tutar OLUŞTURMA ANINDA donan bir FX
  // dönüşümüyle hesaplanır — aynı-alan transferindeki gibi her okumada canlı
  // yeniden hesaplanmaz (artık iki bağımsız satır olduğu için mümkün değil).
  addCrossWorkspaceTransfer: async (input) => {
    const sourceWorkspaceId = useWorkspaceStore.getState().activeId
    if (!sourceWorkspaceId) throw new Error('Aktif çalışma alanı bulunamadı')

    const { sourceCurrency, targetCurrency, amountTry, amountTrySnap, targetAmount } =
      await resolveCrossWorkspaceAmounts(input, sourceWorkspaceId)

    // Borç ödemesi: borç hedef alana ait ve ödenecek yönde (benim borcum) olmalı.
    // Hedef alan yüklü olmadığından borç da ham Dexie'den okunur.
    let targetDebt: Debt | undefined
    if (input.targetDebtId) {
      targetDebt = await db.debts.get(input.targetDebtId)
      if (!targetDebt || !isLive(targetDebt) || !rowInWorkspace(targetDebt, input.targetWorkspaceId)
        || targetDebt.direction !== 'owe' || targetDebt.isSettled) {
        throw new Error('Ödenecek borç bulunamadı')
      }
    }

    const linkId = crypto.randomUUID()
    const now = new Date().toISOString()
    // Kategori analizlerinden hariç tutulsun diye bir ikon işareti taşır —
    // yatırım defter satırlarının kategori dağılımından hariç tutulma
    // deseniyle aynı (bkz. DetailedStats.tsx: `!t.icon` filtresi).
    const ICON = CROSS_WS_ICON

    const outgoing: Transaction = {
      id: crypto.randomUUID(),
      type: 'expense',
      amount: input.amount,
      amountTry: amountTrySnap,
      currency: sourceCurrency,
      date: input.date,
      accountId: input.sourceAccountId,
      icon: ICON,
      description: input.description,
      notes: input.notes,
      isInstallment: false,
      createdAt: now,
      updatedAt: now,
      workspaceId: sourceWorkspaceId,
      workspaceTransferId: linkId,
      peerWorkspaceId: input.targetWorkspaceId,
    }
    const incoming: Transaction = {
      ...outgoing,
      id: crypto.randomUUID(),
      type: 'income',
      amount: targetAmount,
      currency: targetCurrency,
      accountId: input.targetAccountId,
      workspaceId: input.targetWorkspaceId,
      peerWorkspaceId: sourceWorkspaceId,
    }

    // Alanlar arası borç ödemesi: hedef alanda, giriş bacağının yattığı hesaptan
    // sıradan bir borç ödemesi (debtId'li transfer — borçlar sayfasındaki
    // "Ödeme Yap" ile aynı biçim). Böylece hedef alanın borç geçmişi, ödeme
    // takibi ve silme/geri alma akışları ödemeyi kendi satırı olarak görür;
    // hedef hesabın bakiyesi ise giriş + ödeme ile net değişmez. Üç satır da
    // aynı workspaceTransferId'yi taşır → herhangi biri silinince hepsi silinir.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { icon: _icon, ...incomingFields } = incoming
    const payment: Transaction | undefined = targetDebt && {
      ...incomingFields,
      id: crypto.randomUUID(),
      type: 'transfer',
      debtId: targetDebt.id,
    }
    // Borç tutarları TRY bazlıdır (M4) — ödeme satırının TL değeriyle aynı kural.
    const debtPatches = payment
      ? await debtPaymentPatches([{ debtId: payment.debtId!, amount: amountTry }], 1)
      : new Map<string, Partial<Debt>>()

    await localBatch([
      { kind: 'upsert', table: 'transactions', entity: outgoing },
      { kind: 'upsert', table: 'transactions', entity: incoming },
      ...(payment ? [{ kind: 'upsert', table: 'transactions', entity: payment } as BatchOp] : []),
      ...[...debtPatches].map(([id, patch]): BatchOp => ({ kind: 'patch', table: 'debts', id, patch })),
    ], { source: 'form' })
    useDebtStore.getState().applyLocal(debtPatches)

    // Sadece AKTİF alana ait bacak belleğe alınır — karşı bacak o alan
    // yüklenmediği için burada yok; o alana geçilince reconcilingPull getirir.
    const next = [outgoing, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  updateCrossWorkspaceTransfer: async (id, input) => {
    const activeId = useWorkspaceStore.getState().activeId
    if (!activeId) throw new Error('Aktif çalışma alanı bulunamadı')
    const sourceWorkspaceId = input.sourceWorkspaceId ?? activeId
    if (input.targetWorkspaceId === sourceWorkspaceId) throw new Error('Hedef alan kaynak alanla aynı olamaz')

    const cur = get().transactions.find(t => t.id === id)
    if (!cur) throw new Error('İşlem bulunamadı')
    // Taksit/sistem satırı alanlar arası transfere çevrilemez.
    if (cur.isInstallment || cur.installGroupId || cur.systemKind || cur.refundOfId) {
      throw new Error('Bu işlem alanlar arası transfere çevrilemez')
    }

    // Bacaklar: var olan alanlar arası transferde düzenlenen satır + karşı
    // bacaklar sınıflanır. Bağsız satırlar:
    //   • aynı-alan transferi (hedefi hesap) → çıkış bacağına dönüşür; kaynak
    //     aktif alandır;
    //   • aynı-alan borç ödemesi (debtId'li transfer) → ödeme bacağı olarak
    //     yerinde kalır; kaynak diğer alana taşınır, aradaki çıkış/giriş
    //     bacakları yeni doğar (hedef aktif alandır).
    let prevOut: Transaction | undefined
    let prevIn: Transaction | undefined
    let prevPayment: Transaction | undefined
    if (cur.workspaceTransferId) {
      const legs = classifyCrossWsLegs([cur, ...await crossWorkspacePeers(cur)])
      if (!legs.outgoing) throw new Error('Bu alanlar arası transfer düzenlenemez')
      ;({ outgoing: prevOut, incoming: prevIn, payment: prevPayment } = legs)
    } else if (cur.type === 'transfer' && cur.debtId && !cur.toAccountId) {
      prevPayment = cur
    } else if (cur.type !== 'transfer' || cur.debtId) {
      throw new Error('Bu işlem alanlar arası transfere çevrilemez')
    }
    // Düzenlenen satır kendi alanında kalır: çıkıştan düzenlemede kaynak,
    // girişten ya da borç ödemesinden düzenlemede hedef aktif alandır.
    const editingIncoming = cur.id === prevIn?.id || cur.id === prevPayment?.id
    if (editingIncoming ? input.targetWorkspaceId !== activeId : sourceWorkspaceId !== activeId) {
      throw new Error('Düzenlenen bacak kendi alanında kalmalı')
    }

    const { sourceCurrency, targetCurrency, sourceAmount, targetAmount, amountTry, amountTrySnap } =
      await resolveCrossWorkspaceAmounts(input, sourceWorkspaceId, input.amountIn)

    // Borç: hedef alana ait ve ödenecek yönde olmalı. Kapanmış borç yalnız bu
    // ödemenin kendi borcuysa kabul edilir (onu bu ödeme kapatmış olabilir).
    let targetDebt: Debt | undefined
    if (input.targetDebtId) {
      targetDebt = useDebtStore.getState().debts.find(d => d.id === input.targetDebtId)
        ?? await db.debts.get(input.targetDebtId)
      if (!targetDebt || !isLive(targetDebt) || !rowInWorkspace(targetDebt, input.targetWorkspaceId)
        || targetDebt.direction !== 'owe'
        || (targetDebt.isSettled && targetDebt.id !== prevPayment?.debtId)) {
        throw new Error('Ödenecek borç bulunamadı')
      }
    }

    const now = new Date().toISOString()
    const linkId = cur.workspaceTransferId ?? crypto.randomUUID()
    const shared = {
      date:        input.date,
      icon:        CROSS_WS_ICON,
      description: input.description,
      notes:       input.notes,
      amountTry:   amountTrySnap,
      isInstallment: false,
      updatedAt:   now,
      workspaceTransferId: linkId,
    }

    // Çıkış bacağı: var olan çıkış, (bağsız) aynı-alan transferi — o zaman
    // hedef/kategori alanları düşer — ya da (bağsız borç ödemesinden
    // çevrilirken) yepyeni bir satır.
    const outSeed: Transaction = prevOut
      ?? (cur.id === prevPayment?.id
        ? { ...cur, id: crypto.randomUUID(), debtId: undefined, createdAt: now }
        : cur)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { toAccountId: _to, categoryId: _cat, categorySplits: _splits, ...outBase } = outSeed
    const outgoing: Transaction = {
      ...outBase,
      ...shared,
      type:        'expense',
      amount:      sourceAmount,
      currency:    sourceCurrency,
      accountId:   input.sourceAccountId,
      workspaceId: sourceWorkspaceId,
      peerWorkspaceId: input.targetWorkspaceId,
    }
    const incoming: Transaction = {
      ...(prevIn ?? {}),
      ...shared,
      id:            prevIn?.id ?? crypto.randomUUID(),
      type:          'income',
      amount:        targetAmount,
      currency:      targetCurrency,
      accountId:     input.targetAccountId,
      approvalStatus: (prevIn ?? outgoing).approvalStatus,
      createdAt:     prevIn?.createdAt ?? now,
      workspaceId:   input.targetWorkspaceId,
      peerWorkspaceId: sourceWorkspaceId,
    }

    // Borç ödemesi bacağı: giriş bacağının yattığı hesaptan borca transfer
    // (addCrossWorkspaceTransfer ile aynı biçim). Varsa id'si korunur.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { icon: _icon, ...incomingFields } = incoming
    const payment: Transaction | undefined = targetDebt && {
      ...incomingFields,
      id:        prevPayment?.id ?? crypto.randomUUID(),
      type:      'transfer',
      debtId:    targetDebt.id,
      createdAt: prevPayment?.createdAt ?? now,
    }
    // Borç tutarları (TRY): eski ödeme geri alınır, yenisi uygulanır.
    const debtPatches = await debtEditPatches(
      prevPayment?.debtId ? { debtId: prevPayment.debtId, amount: baseAmount(prevPayment) } : undefined,
      payment ? { debtId: payment.debtId!, amount: amountTry } : undefined,
    )
    const removedPayment = prevPayment && !payment ? prevPayment : undefined

    await localBatch([
      { kind: 'upsert', table: 'transactions', entity: outgoing },
      { kind: 'upsert', table: 'transactions', entity: incoming },
      ...(payment ? [{ kind: 'upsert', table: 'transactions', entity: payment } as BatchOp] : []),
      ...(removedPayment
        ? [{ kind: 'patch', table: 'transactions', id: removedPayment.id, patch: { deleted_at: now } } as BatchOp]
        : []),
      ...[...debtPatches].map(([did, patch]): BatchOp => ({ kind: 'patch', table: 'debts', id: did, patch })),
    ], { source: 'form' })
    useDebtStore.getState().applyLocal(debtPatches)

    // Bellek yalnız aktif alanın satırlarını tutar: yazılan bacaklardan aktif
    // alana ait olanlar yerine konur, gerisi (ve silinen ödeme) düşer.
    const written = [outgoing, incoming, ...(payment ? [payment] : [])]
    const touched = new Set([...written.map(t => t.id), ...(removedPayment ? [removedPayment.id] : [])])
    const next = [
      ...get().transactions.filter(t => !touched.has(t.id)),
      ...written.filter(t => t.workspaceId === activeId),
    ]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  detachCrossWorkspaceTransfer: async (id) => {
    const cur = get().transactions.find(t => t.id === id)
    if (!cur?.workspaceTransferId) return
    const peers = await crossWorkspacePeers(cur)
    // Karşı bacaklar (borç ödemesi dahil) silinir; borç katkısı geri alınır.
    if (peers.length) await setDeletedWithDebts([], peers, true)
    const clear: Partial<Transaction> = {
      workspaceTransferId: undefined,
      peerWorkspaceId:     undefined,
      ...(cur.icon === CROSS_WS_ICON ? { icon: undefined } : {}),
    }
    await localPatch('transactions', id, clear, { source: 'form' })
    const peerIds = new Set(peers.map(p => p.id))
    const next = get().transactions
      .filter(t => !peerIds.has(t.id))
      .map(t => t.id === id ? { ...t, ...clear } : t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  addInstallmentGroup: async (base, count, amounts, source = 'form') => {
    const groupId = crypto.randomUUID()
    const now = new Date().toISOString()
    const txs: Transaction[] = []
    // base.amount toplam satın alma tutarı; her işlem AYLIK taksit tutarını
    // taşır. Kullanıcı elle tutar girdiyse (amounts) onlar kullanılır; yoksa
    // banka kuralı: taksitler aşağı yuvarlanır, kuruş kalanı 1. taksite.
    const perInstallment = amounts?.length === count ? amounts : splitInstallments(base.amount, count)
    const rowSplits = base.categorySplits?.length ? splitsForInstallments(base.categorySplits, perInstallment) : null
    for (let i = 0; i < count; i++) {
      const date = format(addMonths(parseISO(base.date), i), 'yyyy-MM-dd')
      // Taksitler onay kapısında BEKLEMEZ: gelecek aylara düşenler dahil hepsi
      // 'approved' doğar ve günü gelince kendiliğinden işlenir (bkz. awaitsApproval).
      // Kategori payları toplam satın alma tutarına göre girilir; her taksit
      // satırı kendi tutarına ölçeklenmiş payları taşır (toplamları o satırın
      // tutarına eşit) — böylece kategori bazlı raporlar taksit taksit doğrudur.
      const splits = rowSplits ? rowSplits[i] : undefined
      txs.push(withSplits(withBase({ ...base, amount: perInstallment[i], categorySplits: splits, id: crypto.randomUUID(), isInstallment: true, installTotal: count, installIndex: i + 1, installGroupId: groupId, date, approvalStatus: 'approved', approvedAt: now, createdAt: now, updatedAt: now })))
    }
    await localBulkUpsert('transactions', txs, { source })
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = [...txs, ...get().transactions]
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
    return txs.map(t => t.id)
  },

  // Taksitli grubu 'ilk giriş' gibi topluca günceller. Mevcut satırların ID'leri
  // KORUNUR (patch) — böylece senkron/geçmiş bozulmaz; taksit sayısı artınca yeni
  // satır eklenir, azalınca fazla satırlar tombstone edilir. `amounts.length` hedef
  // taksit sayısıdır; `shared.date` ilk taksitin tarihidir (sonrakiler +1 ay).
  // Tümü tek undo ile geri alınır. Borç mutabakatı YOKTUR: taksitli işlemler
  // harcamadır, debtId taşımaz (bkz. update yorumu — mutabakatın sahibi form).
  updateInstallmentGroup: async (groupId, shared, amounts) => {
    const count = amounts.length
    if (count < 1) return
    const now = new Date().toISOString()
    const before = get().transactions
    const existing = before
      .filter(t => t.installGroupId === groupId)
      .sort((a, b) => (a.installIndex ?? 0) - (b.installIndex ?? 0))
    if (existing.length === 0) return
    const startDate = shared.date

    const forward: BatchOp[] = []
    const undoOps: BatchOp[] = []
    const nextById = new Map<string, Transaction>()
    const createdIds: string[] = []
    const removedRows = existing.slice(count)   // taksit sayısı azaldıysa

    for (let i = 0; i < count; i++) {
      const date = format(addMonths(parseISO(startDate), i), 'yyyy-MM-dd')
      const rowFields: Partial<Transaction> = {
        ...shared,
        amount:         amounts[i],
        date,
        isInstallment:  true,
        installTotal:   count,
        installIndex:   i + 1,
        installGroupId: groupId,
        updatedAt:      now,
      }
      // Paylar toplam tutara göre gelir → her taksit kendi tutarına ölçeklenir
      // (bkz. addInstallmentGroup). 'categorySplits' shared'da varsa ama boşsa
      // bölme kaldırılmış demektir: alan açıkça null'lanır ki eski paylar kalmasın.
      if ('categorySplits' in shared) {
        const src = shared.categorySplits
        rowFields.categorySplits = src?.length ? splitsForInstallments(src, amounts)[i] : undefined
      }
      if (i < existing.length) {
        const cur = existing[i]
        const merged = withSplits(withBase({ ...cur, ...rowFields } as Transaction))
        const patch: Record<string, unknown> = {
          ...rowFields,
          amountTry:  merged.amountTry ?? null,
          categoryId: merged.categoryId ?? null,   // paylar değiştiyse baskın kategori de taşınır
        }
        forward.push({ kind: 'patch', table: 'transactions', id: cur.id, patch })
        const rev: Record<string, unknown> = {}
        for (const k of Object.keys(patch)) rev[k] = (cur as unknown as Record<string, unknown>)[k] ?? null
        undoOps.push({ kind: 'patch', table: 'transactions', id: cur.id, patch: rev })
        nextById.set(cur.id, merged)
      } else {
        // Yeni satır: ilk taksiti şablon al; taksit onay beklemez → 'approved'.
        const row = withSplits(withBase({
          ...existing[0],
          ...rowFields,
          id:             crypto.randomUUID(),
          approvalStatus: 'approved',
          approvedAt:     now,
          createdAt:      now,
        } as Transaction))
        forward.push({ kind: 'upsert', table: 'transactions', entity: row })
        createdIds.push(row.id)
        nextById.set(row.id, row)
      }
    }

    await localBatch(forward, { source: 'form' })
    if (removedRows.length) await softDeleteMany('transactions', removedRows.map(t => t.id), { source: 'form' })

    // Local state: çıkarılanları filtrele, güncellenen/eklenen satırları uygula.
    const removedIds = new Set(removedRows.map(t => t.id))
    const next = get().transactions
      .filter(t => !removedIds.has(t.id))
      .map(t => nextById.get(t.id) ?? t)
    for (const id of createdIds) if (!next.some(t => t.id === id)) next.push(nextById.get(id)!)
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    // Undo: patch'leri geri al, yeni satırları tombstone et, çıkarılanları geri
    // getir — sonra yerel durumu orijinal gruba (`existing`) döndür.
    useUndoStore.getState().pushUndo('Taksitli işlem güncellendi', async () => {
      await localBatch(undoOps, { source: 'undo' })
      if (createdIds.length) await softDeleteMany('transactions', createdIds, { source: 'undo' })
      for (const t of removedRows) await localPatch('transactions', t.id, { deleted_at: null }, { source: 'undo' })
      const reverted = get().transactions.filter(t => t.installGroupId !== groupId)
      reverted.push(...existing)
      reverted.sort(txSortComparator)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
  },

  // Var olan TEKİL bir işlemi taksitli gruba DÖNÜŞTÜRÜR ("bunu sonradan
  // taksitlendir"). Satırın kendisi 1. taksit olur — id KORUNUR, böylece
  // senkron/geçmiş ve satıra bağlı kayıtlar (iade vb.) bozulmaz; kalan
  // taksitler yeni satır olarak doğar (+1 ay, onay beklemez → 'approved').
  // `amounts` hedef taksit tutarlarıdır
  // (toplamı satın alma tutarı), `shared.date` ilk taksitin tarihi.
  // Tek undo ile geri alınır: satır eski haline döner, üretilenler tombstone.
  // Mutabakat gerektiren satırlar (borç ödemesi, alanlar arası transfer bacağı,
  // iade, sistem kaydı) ve negatif tutarlar bu yoldan GEÇMEZ — değişmez burada
  // da uygulanır ki form dışı çağrılar da sızdırmasın.
  convertToInstallmentGroup: async (id, shared, amounts) => {
    const count = amounts.length
    if (count < 2) return
    const cur = get().transactions.find(t => t.id === id)
    if (!cur || cur.isInstallment || cur.installGroupId) return
    if (cur.debtId || cur.workspaceTransferId || cur.systemKind || cur.refundOfId) return
    if (cur.amount <= 0) return
    const now = new Date().toISOString()
    const groupId = crypto.randomUUID()

    const forward: BatchOp[] = []
    const nextById = new Map<string, Transaction>()
    const createdIds: string[] = []
    const headUndo: Record<string, unknown> = {}

    for (let i = 0; i < count; i++) {
      const date = format(addMonths(parseISO(shared.date), i), 'yyyy-MM-dd')
      const rowFields: Partial<Transaction> = {
        ...shared,
        amount:         amounts[i],
        date,
        isInstallment:  true,
        installTotal:   count,
        installIndex:   i + 1,
        installGroupId: groupId,
        updatedAt:      now,
      }
      // Paylar TOPLAM tutara göre gelir → her taksit kendi tutarına ölçeklenir
      // (bkz. addInstallmentGroup); boş gelirse bölme kaldırılmış demektir.
      if ('categorySplits' in shared) {
        const src = shared.categorySplits
        rowFields.categorySplits = src?.length ? splitsForInstallments(src, amounts)[i] : undefined
      }
      if (i === 0) {
        const merged = withSplits(withBase({ ...cur, ...rowFields } as Transaction))
        const patch: Record<string, unknown> = {
          ...rowFields,
          amountTry:      merged.amountTry ?? null,
          categoryId:     merged.categoryId ?? null,
          categorySplits: merged.categorySplits ?? null,
        }
        for (const k of Object.keys(patch)) headUndo[k] = (cur as unknown as Record<string, unknown>)[k] ?? null
        forward.push({ kind: 'patch', table: 'transactions', id: cur.id, patch })
        nextById.set(cur.id, merged)
      } else {
        // Yeni taksit: dönüştürülen satır şablon; taksit onay beklemez →
        // gelecek tarihliler de 'approved' doğar (bkz. awaitsApproval).
        const row = withSplits(withBase({
          ...cur,
          ...rowFields,
          id:             crypto.randomUUID(),
          approvalStatus: 'approved',
          approvedAt:     now,
          createdAt:      now,
        } as Transaction))
        forward.push({ kind: 'upsert', table: 'transactions', entity: row })
        createdIds.push(row.id)
        nextById.set(row.id, row)
      }
    }

    await localBatch(forward, { source: 'form' })

    const next = get().transactions.map(t => nextById.get(t.id) ?? t)
    for (const cid of createdIds) if (!next.some(t => t.id === cid)) next.push(nextById.get(cid)!)
    next.sort(txSortComparator)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    useUndoStore.getState().pushUndo('İşlem taksitlendirildi', async () => {
      await localBatch([{ kind: 'patch', table: 'transactions', id: cur.id, patch: headUndo }], { source: 'undo' })
      if (createdIds.length) await softDeleteMany('transactions', createdIds, { source: 'undo' })
      const createdSet = new Set(createdIds)
      const reverted = get().transactions
        .filter(t => !createdSet.has(t.id))
        .map(t => t.id === cur.id ? cur : t)
      reverted.sort(txSortComparator)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
  },

  // Tutar alanını doğrudan yamalar: toplam korunur, yalnızca kuruşlar taksitler
  // arasında yer değiştirir. Kategori payları yeni tutara ölçeklenir; TRY
  // karşılığı (amountTry) aynı oranla güncellenir (kur yeniden okunmaz).
  fixInstallmentRounding: async () => {
    const fixes = findInstallmentRoundingFixes(get().transactions)
    if (fixes.length === 0) return 0
    const now = new Date().toISOString()
    type PatchOp = Extract<BatchOp, { kind: 'patch' }>
    const forward: PatchOp[] = []
    const undoOps: PatchOp[] = []
    const nextById = new Map<string, Transaction>()
    const prevById = new Map<string, Transaction>()

    for (const fix of fixes) {
      // Kategori payları grup düzeyinde yeniden dağıtılır: satır satır ölçeklemek
      // (rescaleSplits) kategori toplamlarını kuruş kaydırıyordu. Kategori
      // toplamları korunur, yalnız taksitler arası dağılım yeni tutarlara uyar.
      const groupRows = get().transactions
        .filter(t => t.installGroupId === fix.groupId && !t.deleted_at)
        .sort((x, y) => (x.installIndex ?? 0) - (y.installIndex ?? 0))
      const newAmount = new Map(fix.changes.map(c => [c.tx.id, c.amount]))
      const groupSplits = groupRows.length ? groupCategorySplits(groupRows[0], groupRows) : undefined
      const rowSplits = groupSplits && groupSplits.length > 1
        ? splitsForInstallments(groupSplits, groupRows.map(t => newAmount.get(t.id) ?? t.amount))
        : null
      const rowChanges = groupRows
        .map((tx, i) => ({ tx, amount: newAmount.get(tx.id) ?? tx.amount, splits: rowSplits ? rowSplits[i] : tx.categorySplits }))
        .filter(c => newAmount.has(c.tx.id) || (rowSplits && !splitsEqual(c.tx.categorySplits, c.splits)))
      for (const { tx, amount, splits } of rowChanges) {
        const amountTry = tx.amountTry == null || amount === tx.amount ? tx.amountTry : mulMoney(tx.amountTry, amount / tx.amount)
        const merged = withSplits({ ...tx, amount, amountTry, categorySplits: splits, updatedAt: now })
        const patch: Record<string, unknown> = {
          amount,
          amountTry:      merged.amountTry ?? null,
          categorySplits: merged.categorySplits ?? null,
          categoryId:     merged.categoryId ?? null,
          updatedAt:      now,
        }
        const rev: Record<string, unknown> = {}
        for (const k of Object.keys(patch)) rev[k] = (tx as unknown as Record<string, unknown>)[k] ?? null
        forward.push({ kind: 'patch', table: 'transactions', id: tx.id, patch })
        undoOps.push({ kind: 'patch', table: 'transactions', id: tx.id, patch: rev })
        nextById.set(tx.id, merged)
        prevById.set(tx.id, tx)
      }
    }

    await localBatch(forward, { source: 'app' })
    const next = get().transactions.map(t => nextById.get(t.id) ?? t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    useUndoStore.getState().pushUndo(`${fixes.length} taksitli işlemin kuruşları düzeltildi`, async () => {
      await localBatch(undoOps, { source: 'undo' })
      const reverted = get().transactions.map(t => prevById.get(t.id) ?? t)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
    return fixes.length
  },

  fixInstallmentSplits: async () => {
    const { fixes } = findInstallmentSplitFixes(get().transactions)
    if (fixes.length === 0) return 0
    const now = new Date().toISOString()
    type PatchOp = Extract<BatchOp, { kind: 'patch' }>
    const forward: PatchOp[] = []
    const undoOps: PatchOp[] = []
    const nextById = new Map<string, Transaction>()
    const prevById = new Map<string, Transaction>()

    for (const fix of fixes) {
      for (const { tx, splits } of fix.changes) {
        // Satır tutarı değişmez → amountTry aynen kalır; yalnız paylar (ve en
        // büyük paya bağlı categoryId) yeniden yazılır.
        const merged = withSplits({ ...tx, categorySplits: splits, updatedAt: now })
        const patch: Record<string, unknown> = {
          categorySplits: merged.categorySplits ?? null,
          categoryId:     merged.categoryId ?? null,
          updatedAt:      now,
        }
        const rev: Record<string, unknown> = {}
        for (const k of Object.keys(patch)) rev[k] = (tx as unknown as Record<string, unknown>)[k] ?? null
        forward.push({ kind: 'patch', table: 'transactions', id: tx.id, patch })
        undoOps.push({ kind: 'patch', table: 'transactions', id: tx.id, patch: rev })
        nextById.set(tx.id, merged)
        prevById.set(tx.id, tx)
      }
    }

    await localBatch(forward, { source: 'app' })
    const next = get().transactions.map(t => nextById.get(t.id) ?? t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    useUndoStore.getState().pushUndo(`${fixes.length} taksitli işlemin kategori payları onarıldı`, async () => {
      await localBatch(undoOps, { source: 'undo' })
      const reverted = get().transactions.map(t => prevById.get(t.id) ?? t)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
    return fixes.length
  },

  update: async (id, patch, source = 'form') => {
    const now = new Date().toISOString()
    const updated: Partial<Transaction> = { ...patch, updatedAt: now }
    // Re-snapshot amountTry whenever amount or currency changes (S2/S3).
    // withBase ile AYNI kural (baseSnapshot): kur henüz yoksa yanlış bir ham
    // değer damgalamak yerine snapshot'ı temizleriz — baseAmount() kurlar
    // gelince canlı çevirir. Eskiden koşulsuz toBaseTry çağrılıyordu ve fiyatlar
    // yüklenmeden düzenlenen $100 kalıcı olarak 100₺ diye kaydoluyordu.
    let clearBase = false
    if ('amount' in patch || 'currency' in patch) {
      const cur = get().transactions.find(t => t.id === id)
      if (cur) {
        const merged = { ...cur, ...patch }
        const snap = baseSnapshot(merged.amount, merged.currency)
        // Eski snapshot yeni tutara ait DEĞİL → kur yoksa da bırakılamaz.
        updated.amountTry = snap ?? undefined
        clearBase = snap === null
      }
    }
    // Çoklu kategori: patch payları YA DA tutarı değiştiriyorsa değişmezi
    // yeniden kur. Tutar payları göndermeden değiştiyse (form dışı yollar)
    // paylar mevcut oranlarıyla ölçeklenir; toplamı tutmayan bir bölünme
    // hiçbir zaman kalıcı olmaz — geçersizse alan tamamen düşer.
    let clearSplits = false
    if ('categorySplits' in patch || 'amount' in patch) {
      const cur = get().transactions.find(t => t.id === id)
      if (cur) {
        const merged = { ...cur, ...updated } as Transaction
        let splits = merged.categorySplits
        if (splits && splits.length > 1 && !('categorySplits' in patch) && !splitsMatchAmount(splits, merged.amount)) {
          splits = rescaleSplits(splits, merged.amount)
        }
        if (splitsAreValid(splits, merged.amount)) {
          updated.categorySplits = splits
          updated.categoryId     = primarySplitCategoryId(splits)
        } else if (cur.categorySplits !== undefined || 'categorySplits' in patch) {
          // Satırda pay VARDI ya da patch açıkça pay gönderdi → temizleme
          // niyeti açık null ile gider. `merged`e bakmak yetmez: patch
          // `categorySplits: undefined` gönderdiğinde merged de undefined olur
          // ve eski paylar sessizce yerinde kalırdı.
          updated.categorySplits = undefined
          clearSplits = true
        }
      }
    }
    // Onay kapısı YALNIZ ileri tarihli kayıtlar içindir (withApproval): tarihi
    // gelmemiş kayıt gününde onay ister. Bekleyen bir kaydın tarihi bugüne ya da
    // geçmişe çekilirse kayıt artık "gelecek" değildir — damga düşer ve satır
    // doğrudan işlenir. Damga eskiden takılı kalıyordu: yanlışlıkla ileri
    // tarihle girilip hemen düzeltilen kayıt bakiyeye hiç girmeden bildirimde
    // sonsuza dek onay bekliyordu. Çağıran damgayı açıkça yönettiyse karışılmaz.
    if (typeof patch.date === 'string' && !('approvalStatus' in patch)) {
      const cur = get().transactions.find(t => t.id === id)
      if (cur?.approvalStatus === 'pending' && patch.date.slice(0, 10) <= today()) {
        updated.approvalStatus = 'approved'
        updated.approvedAt     = now
      }
    }
    // Dexie/Supabase'e `undefined` yazmak alanı ATLAR (eski snapshot kalırdı) →
    // temizleme niyetini açık `null` ile gönder.
    const persisted: Record<string, unknown> = { ...updated }
    if (clearBase)   persisted.amountTry     = null
    if (clearSplits) persisted.categorySplits = null
    await localPatch('transactions', id, persisted, { source })
    // NOT: Borç paidAmount mutabakatı burada YAPILMAZ — düzenleme akışının tek
    // sahibi TransactionFormModal'dır (borç değişimi/kaldırma dahil tüm dalları
    // yönetir). Burada da ayarlamak çift sayıma yol açıyordu.
    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const next = get().transactions.map(t => t.id === id ? { ...t, ...updated } : t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)
  },

  // Toplu düzenleme (batch edit). Yalnızca mutabakat GEREKTİRMEYEN alanlar için
  // kullanılır — kategori, tarih, aile üyesi, alıcı, etiket. `amount`/`type`/
  // `debtId` GİBİ borç-taksit mutabakatını tetikleyen alanlar burada DÜZENLENMEZ;
  // o akışın tek sahibi TransactionFormModal'dır (bkz. update yorumu). addTags
  // verilirse etiketler satır-satır BİRLEŞTİRİLİR (mevcut etiketler korunur).
  // Tüm satırlar tek bir atomik localBatch içinde yazılır ve değişiklik geri
  // alınabilir (her satırın eski değerleri snapshot'lanır).
  updateMany: async (ids, patch, opts, source = 'batch') => {
    const now = new Date().toISOString()
    const before = get().transactions
    const txById = new Map(before.map(t => [t.id, t]))
    const affected = ids.filter(id => txById.has(id))
    if (affected.length === 0) return

    const addTags = (opts?.addTags ?? []).map(t => t.trim()).filter(Boolean)
    const keys = Object.keys(patch) as (keyof Transaction)[]

    type PatchOp = Extract<BatchOp, { kind: 'patch' }>
    const forward: PatchOp[] = []
    const undoOps: PatchOp[] = []
    for (const id of affected) {
      const t = txById.get(id)!
      const fwd: Record<string, unknown> = { ...patch, updatedAt: now }
      const rev: Record<string, unknown> = { updatedAt: t.updatedAt }
      for (const k of keys) rev[k] = (t as unknown as Record<string, unknown>)[k] ?? null
      // Toplu kategori ataması bölünmüş satırı TEK kategoriye indirger: paylar
      // yeni kategoriyle çelişmesin diye temizlenir (geri alınabilir — eski
      // paylar rev'e snapshot'lanır).
      if ('categoryId' in patch && t.categorySplits?.length) {
        fwd.categorySplits = null
        rev.categorySplits = t.categorySplits
      }
      if (addTags.length) {
        fwd.tags = [...new Set([...(t.tags ?? []), ...addTags])]
        rev.tags = t.tags ? [...t.tags] : null
      }
      // update() ile aynı kural: tarihi bugüne/geçmişe çekilen bekleyen satırın
      // onay damgası düşer (geri alınabilir — eski damga rev'e snapshot'lanır).
      if (typeof fwd.date === 'string' && !('approvalStatus' in patch) &&
          t.approvalStatus === 'pending' && (fwd.date as string).slice(0, 10) <= today()) {
        fwd.approvalStatus = 'approved'
        fwd.approvedAt     = now
        rev.approvalStatus = t.approvalStatus
        rev.approvedAt     = t.approvedAt ?? null
      }
      forward.push({ kind: 'patch', table: 'transactions', id, patch: fwd })
      undoOps.push({ kind: 'patch', table: 'transactions', id, patch: rev })
    }

    await localBatch(forward, { source })

    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    const fwdById = new Map(forward.map(o => [o.id, o.patch]))
    const next = get().transactions.map(t => fwdById.has(t.id) ? { ...t, ...fwdById.get(t.id) } : t)
    set({ transactions: next })
    useAccountStore.getState().recomputeBalances(next)

    const label = affected.length > 1 ? `${affected.length} işlem düzenlendi` : 'İşlem düzenlendi'
    useUndoStore.getState().pushUndo(label, async () => {
      await localBatch(undoOps, { source: 'undo' })
      const revById = new Map(undoOps.map(o => [o.id, o.patch]))
      const reverted = get().transactions.map(t => revById.has(t.id) ? { ...t, ...revById.get(t.id) } : t)
      set({ transactions: reverted })
      useAccountStore.getState().recomputeBalances(reverted)
    })
  },

  // Etiket yeniden adlandırma. Etiketler ayrı bir varlık değil — her işlemin
  // `tags` dizisinde serbest metin olarak yaşar. "Düzenleme" bu yüzden tek satır
  // değil, eski etiketi (case-insensitive tagKey ile) TAŞIYAN TÜM işlemleri tek
  // atomik localBatch içinde günceller ve geri alınabilir. Yeni ad mevcut başka
  // bir etiketle çakışırsa dedupeTags aynı işlemdeki kopyaları birleştirir; bu
  // durumda iki etiket tek etikette birleşir (kasıtlı — birleştirme davranışı).
  renameTag: async (oldTag, newTag) => {
    const from = tagKey(oldTag)
    const to   = normalizeTag(newTag)
    if (!from || !to) return
    const now = new Date().toISOString()

    type PatchOp = Extract<BatchOp, { kind: 'patch' }>
    const forward: PatchOp[] = []
    const undoOps: PatchOp[] = []
    for (const t of get().transactions) {
      if (!t.tags?.some(x => tagKey(x) === from)) continue
      // Eşleşen etiketi yeni etiketle değiştir (sırayı koru), sonra dedupe et.
      const nextTags = dedupeTags(t.tags.map(x => (tagKey(x) === from ? to : x)))
      forward.push({ kind: 'patch', table: 'transactions', id: t.id, patch: { tags: nextTags, updatedAt: now } })
      undoOps.push({ kind: 'patch', table: 'transactions', id: t.id, patch: { tags: [...t.tags], updatedAt: t.updatedAt } })
    }
    if (forward.length === 0) return

    await localBatch(forward, { source: 'batch' })

    const fwdById = new Map(forward.map(o => [o.id, o.patch]))
    const next = get().transactions.map(t => fwdById.has(t.id) ? { ...t, ...fwdById.get(t.id) } : t)
    set({ transactions: next })

    useUndoStore.getState().pushUndo(`Etiket yeniden adlandırıldı (${forward.length} işlem)`, async () => {
      await localBatch(undoOps, { source: 'undo' })
      const revById = new Map(undoOps.map(o => [o.id, o.patch]))
      const reverted = get().transactions.map(t => revById.has(t.id) ? { ...t, ...revById.get(t.id) } : t)
      set({ transactions: reverted })
    })
  },

  remove: async (id, opts, source = 'form') => {
    const all = get().transactions
    const tx = all.find(t => t.id === id)
    // Taksitli işlem: tek taksit yalnız silinmez — satın almanın TÜM taksitleri
    // (aynı installGroupId) birlikte silinir ve undo hepsini birlikte geri getirir.
    // Faiz gelirinin stopaj gideri (interest-tax.ts) satırla birlikte silinir.
    const group = withLinkedInterestTax(tx?.installGroupId
      ? all.filter(t => t.installGroupId === tx.installGroupId)
      : tx ? [tx] : [], all)

    // Çalışma alanları arası transferin karşı bacak(lar)ı ham Dexie'den bulunup
    // onlar da tombstone'lanır (yetim kayıt kalmasın; mimari kısıt olarak
    // onaylandı: düzenleme karşı bacağa yansımaz ama silme yansır).
    const peers = await findTransferPeers(group)

    // Soft delete (C3) via the durable outbox: syncs as an UPDATE and cannot
    // resurrect on the next reconciling pull. Bağlı borca katkı TRY tabanıyla
    // geri alınır ve paidInstallments de azalır (M3, M4) — atomik (#22).
    await setDeletedWithDebts(group, peers, true, source)

    // Pure updater: compute next array, set it, THEN fire the cross-store effect.
    // Aktif alandaki karşı bacaklar (alanlar arası borç ödemesi) bellekte de
    // durur → onlar da düşer ve undo'da geri gelir.
    const { removed: localPeers, remaining } = dropRemoved(get().transactions, group, peers)
    set({ transactions: remaining })
    useAccountStore.getState().recomputeBalances(remaining)

    // Undo: un-tombstone, re-insert (sorted), recompute, and re-apply the debt
    // payment — symmetric with the revertPayment above (recordPayment +amount,
    // +1 installment ↔ revertPayment -amount, -1 installment).
    if (group.length && opts?.undoable !== false) {
      const label = tx?.installGroupId && group.length > 1
        ? `Taksitli işlem silindi (${group.length} taksit)`
        : group.length > 1 ? 'Faiz ve stopajı silindi' : 'İşlem silindi'
      useUndoStore.getState().pushUndo(label, async () => {
        await setDeletedWithDebts(group, peers, false, 'undo')
        const next = [...group, ...localPeers, ...get().transactions]
        next.sort(txSortComparator)
        set({ transactions: next })
        useAccountStore.getState().recomputeBalances(next)
      })
    }
  },

  // Toplu silme (batch delete). Tek-satır remove ile AYNI semantik: taksitli bir
  // işlem seçilince satın almanın TÜM taksitleri (installGroupId) silinir, borç
  // katkıları geri alınır. Fark: tüm seçim TEK bir "geri al" ile geri gelir ve
  // bakiye bir kez yeniden hesaplanır. Yatırım satışına bağlı satırların özel
  // temizliği burada YAPILMAZ (drawer onları hariç tutar) — tıpkı update gibi
  // mutabakat-karmaşık kayıtlar batch dışında bırakılır.
  removeMany: async (ids) => {
    const all = get().transactions
    const byId = new Map(all.map(t => [t.id, t]))
    const targetIds = new Set<string>()
    for (const id of ids) {
      const tx = byId.get(id)
      if (!tx) continue
      if (tx.installGroupId) {
        for (const t of all) if (t.installGroupId === tx.installGroupId) targetIds.add(t.id)
      } else {
        targetIds.add(id)
      }
    }
    const group = withLinkedInterestTax([...targetIds].map(id => byId.get(id)!).filter(Boolean), all)
    if (group.length === 0) return

    // Karşı bacağı da tombstone'la (bkz. remove() yorumu) — grup içinde her
    // iki bacak birden seçilmişse (nadir) zaten grupta olan tekrar eklenmez.
    const peers = await findTransferPeers(group)

    await setDeletedWithDebts(group, peers, true, 'batch')

    const { removed: localPeers, remaining } = dropRemoved(get().transactions, group, peers)
    set({ transactions: remaining })
    useAccountStore.getState().recomputeBalances(remaining)

    const label = group.length > 1 ? `${group.length} işlem silindi` : 'İşlem silindi'
    useUndoStore.getState().pushUndo(label, async () => {
      await setDeletedWithDebts(group, peers, false, 'undo')
      const next = [...group, ...localPeers, ...get().transactions]
      next.sort(txSortComparator)
      set({ transactions: next })
      useAccountStore.getState().recomputeBalances(next)
    })
  },

  getFiltered: (filters, transactions) => {
    // İkinci parametre isteğe bağlı: özet toplamlar taksit-indirgenmiş bir dizi
    // üzerinde aynı filtreleri uygulamak isteyebilir (bkz. transactions/page.tsx
    // özet çubuğu) — verilmezse her zamanki gibi ham store dizisi kullanılır.
    let txs = transactions ?? get().transactions
    // txTouchesAccount: transferin HEDEF bacağı da bu hesabın işlemidir —
    // yalnız accountId'ye bakmak gelen transferleri listeden gizliyordu.
    if (filters.accountIds?.length) txs = txs.filter(t => filters.accountIds!.some(id => txTouchesAccount(t, id)))
    // txHasCategory: bölünmüş işlem PAYLARINDAN biri eşleşse de listelenir — yalnız
    // categoryId'ye (baskın pay) bakılınca ikincil payın kategorisinde görünmüyordu.
    if (filters.categoryIds?.length) txs = txs.filter(t => filters.categoryIds!.some(id => txHasCategory(t, id)))
    if (filters.types?.length) txs = txs.filter(t => filters.types!.includes(t.type))
    if (filters.familyMemberIds?.length) txs = txs.filter(t => t.familyMemberId && filters.familyMemberIds!.includes(t.familyMemberId))
    if (filters.recipientIds?.length) txs = txs.filter(t => t.recipientId && filters.recipientIds!.includes(t.recipientId))
    if (filters.dateFrom && filters.dateTo) txs = txs.filter(t => isInRange(t.date, filters.dateFrom!, filters.dateTo!))
    if (filters.search) {
      // Tüm alanlarda arama — kişi/kategori/hesap adları dahil (bkz. txSearch.ts)
      txs = txs.filter(makeTxSearchMatcher(filters.search, {
        people:     usePeopleStore.getState().people,
        categories: useCategoryStore.getState().categories,
        accounts:   useAccountStore.getState().accounts,
      }))
    }
    return txs
  },
}))
