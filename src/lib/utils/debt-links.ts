import type { Debt, Transaction } from '@/types'
import { DEBT_PRINCIPAL_IN_SUFFIX, DEBT_PRINCIPAL_OUT_SUFFIX, isDebtPrincipalTx } from './calculations'

/* ────────────────────────────────────────────────────────────────────────
   Borç ANAPARASI satırının (paranın hesaba girişi / hesaptan çıkışı)
   borcuyla eşleştirilmesi. Borç alım tarihi geriye dönük düzenlendiğinde
   anaparanın hesap giriş tarihini de taşımak için gerekir.

   Öncelik sırası (investment-links.ts'teki P&L bağıyla aynı desen):
     1. ID bağı — `debtPrincipalId` alanı borcun id'sini taşıyorsa yalnız o
        satır. Aynı isimde iki borç olsa bile başka satıra dokunulmaz.
     2. Alan eklenmeden ÖNCE yazılmış satırlar → icon + açıklama eşleşmesi.
        Yalnızca TEK aday varsa döner: birden fazla eşleşmede hangisinin
        doğru olduğu bilinemez, yanlış satırı taşımaktansa hiç dokunmamak
        doğrudur (mevcut kullanıcı verisi).

   Saf fonksiyon: store'a dokunmaz, kararı test edilebilir kılar.
──────────────────────────────────────────────────────────────────────── */

type PrincipalTxCandidate = Pick<Transaction, 'icon' | 'description' | 'debtPrincipalId'>

/** Anapara satırının açıklaması — akış toplamlarından dışlanmayı sağlayan
 *  son ek (isDebtPrincipalTx) buradan gelir, tek kaynak. */
export function debtPrincipalDescription(debt: Pick<Debt, 'name' | 'direction'>): string {
  const suffix = debt.direction === 'owe' ? DEBT_PRINCIPAL_IN_SUFFIX : DEBT_PRINCIPAL_OUT_SUFFIX
  return `${debt.name} — ${suffix}`
}

export function findDebtPrincipalTx<T extends PrincipalTxCandidate>(
  debt: Pick<Debt, 'id' | 'name' | 'direction'>,
  transactions: readonly T[],
): T | undefined {
  const linked = transactions.find(t => t.debtPrincipalId === debt.id)
  if (linked) return linked

  const description = debtPrincipalDescription(debt)
  const matches = transactions.filter(t =>
    !t.debtPrincipalId &&          // başka bir borca bağlanmış satır aday değil
    isDebtPrincipalTx(t) &&
    t.description === description,
  )
  return matches.length === 1 ? matches[0] : undefined
}
