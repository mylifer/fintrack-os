import { supabase } from './supabase'
import { db } from './db'

export async function getUserId(): Promise<string | undefined> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id
}

export async function clearLocalData(): Promise<void> {
  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.categories.clear(),
    db.budgets.clear(),
    db.debts.clear(),
    db.investmentTransactions.clear(),
    db.people.clear(),
    db.recurringTransactions.clear(),
  ])
}
