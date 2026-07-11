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
    db._outbox.clear(), // drop pending mutations on a full local reset
  ])
  // Shared-device hardening: wipe ALL browser storage so nothing (migration
  // flags like inv_sell_pnl_v3, zustand-persist 'fintrack-ui', etc.) leaks to
  // the next user. A blanket clear is safe here — no app key must survive a
  // logout on a per-user finance app. The only device-level preference we keep
  // is the theme ('fintrack-theme'), which is cosmetic and tenant-agnostic.
  if (typeof window !== 'undefined') {
    const theme = localStorage.getItem('fintrack-theme')
    localStorage.clear()
    sessionStorage.clear()
    if (theme !== null) localStorage.setItem('fintrack-theme', theme)
    // ft_last_uid (shared-device switch detection) is cleared by localStorage.clear() above.
  }
}
