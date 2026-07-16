'use client'

import { db } from '@/lib/db'
import { isLive } from '@/lib/sync/tombstone'
import { softDeleteMany } from '@/lib/sync/engine'

/* ── Demo kalıntısı tespiti ve temizliği ────────────────────────────────────
   Eski demo veri seti SABİT, sıfır dolgulu UUID'ler kullanıyordu
   (a0000000-… hesaplar, b0000000-… kişiler, cc000000-… işlemler, d0000000-…
   bütçeler, e0000000-… borçlar, f0000000-… tekrarlayanlar, 10000000-…
   yatırımlar). Gerçek kayıtlar crypto.randomUUID() ürettiği için bu kalıba
   pratikte asla düşmez — kalıp, demo satırlarını güvenle ayırt eder.
   Ek olarak demo hesaplara bağlı (ör. tekrarlayan kurallardan üretilmiş)
   rastgele kimlikli işlemler de bağlantı üzerinden yakalanır. */

const DEMO_ID = /^(?:a0|b0|cc|d0|e0|f0|10)000000-0000-0000-0000-[0-9a-f]{12}$/i

export const isDemoId = (id: string | null | undefined): boolean =>
  !!id && DEMO_ID.test(id)

export interface DemoScan {
  accounts: number
  people: number
  transactions: number
  budgets: number
  debts: number
  recurring: number
  investments: number
  total: number
  /** Silinecek satır kimlikleri — removeDemoData bunları kullanır */
  ids: Record<'accounts' | 'people' | 'transactions' | 'budgets' | 'debts' | 'recurring_transactions' | 'investment_transactions', string[]>
}

export async function scanDemoData(): Promise<DemoScan> {
  const [accounts, people, transactions, budgets, debts, recurring, investments] = await Promise.all([
    db.accounts.toArray(),
    db.people.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.debts.toArray(),
    db.recurringTransactions.toArray(),
    db.investmentTransactions.toArray(),
  ])

  const demoAccIds = new Set(accounts.filter(a => isLive(a) && isDemoId(a.id)).map(a => a.id))
  const demoPplIds = new Set(people.filter(p => isLive(p) && isDemoId(p.id)).map(p => p.id))

  const ids: DemoScan['ids'] = {
    accounts: [...demoAccIds],
    people:   [...demoPplIds],
    // Demo kimlikli işlemler + demo hesaplara/kişilere bağlı işlemler
    transactions: transactions.filter(t => isLive(t) && (
      isDemoId(t.id) ||
      demoAccIds.has(t.accountId) ||
      (t.toAccountId ? demoAccIds.has(t.toAccountId) : false) ||
      (t.recipientId ? demoPplIds.has(t.recipientId) : false) ||
      (t.familyMemberId ? demoPplIds.has(t.familyMemberId) : false)
    )).map(t => t.id),
    budgets: budgets.filter(b => isLive(b) && isDemoId(b.id)).map(b => b.id),
    debts:   debts.filter(d => isLive(d) && isDemoId(d.id)).map(d => d.id),
    recurring_transactions: recurring.filter(r => isLive(r) && (
      isDemoId(r.id) || demoAccIds.has(r.accountId)
    )).map(r => r.id),
    investment_transactions: investments.filter(i => isLive(i) && isDemoId(i.id)).map(i => i.id),
  }

  return {
    accounts:     ids.accounts.length,
    people:       ids.people.length,
    transactions: ids.transactions.length,
    budgets:      ids.budgets.length,
    debts:        ids.debts.length,
    recurring:    ids.recurring_transactions.length,
    investments:  ids.investment_transactions.length,
    total: Object.values(ids).reduce((n, arr) => n + arr.length, 0),
    ids,
  }
}

/** Taranan demo satırlarını tombstone'lar (softDelete) — normal senkron
 *  yoluyla buluttan da kalkar. Yalnızca scanDemoData çıktısıyla çağrılır ki
 *  kullanıcı silinecekleri önce görmüş olsun. */
export async function removeDemoData(scan: DemoScan): Promise<void> {
  // Önce bağlı kayıtlar, sonra üst kayıtlar (tombstone = update; FK engeli yok
  // ama sıra, yarıda kesilmede öksüz referans bırakmamak için korunur).
  await softDeleteMany('transactions',            scan.ids.transactions)
  await softDeleteMany('budgets',                 scan.ids.budgets)
  await softDeleteMany('recurring_transactions',  scan.ids.recurring_transactions)
  await softDeleteMany('investment_transactions', scan.ids.investment_transactions)
  await softDeleteMany('debts',                   scan.ids.debts)
  await softDeleteMany('people',                  scan.ids.people)
  await softDeleteMany('accounts',                scan.ids.accounts)
}
