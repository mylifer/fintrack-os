import { excludeFuture } from '@/lib/utils/calculations'
import { baseAmount, fromBaseTry } from '@/lib/utils/fx'
import { toMinor, toMajor } from '@/lib/utils/money'
import { today } from '@/lib/utils/date'
import type { Account, Transaction } from '@/types'

// Tek işlemin hesabın KENDİ para biriminde bakiyeye kuruş etkisi
// (computeTransactionEffect ile birebir aynı kural — S2 çapraz-kur dahil).
function effectMinor(account: Pick<Account, 'id' | 'currency'>, t: Transaction): number {
  if (t.type === 'transfer') {
    let m = 0
    if (t.accountId === account.id) m -= toMinor(t.amount)
    if (t.toAccountId === account.id) {
      const incoming = t.currency === account.currency ? t.amount : fromBaseTry(baseAmount(t), account.currency)
      m += toMinor(incoming)
    }
    return m
  }
  if (t.accountId === account.id) return t.type === 'income' ? toMinor(t.amount) : -toMinor(t.amount)
  return 0
}

/**
 * [from, to] aralığında hesabın gün-sonu bakiye serisi (hesabın kendi biriminde).
 * Anchor = initialBalance (güncel bakiyenin türetildiği aynı kaynak). Yalnız
 * kayıtlı (posted) işlemler; gelecek/pending hariç. Maliyeti sınırlamak için en
 * çok ~SAMPLES eşit örnek noktası üretilir.
 */
export function balanceSeries(
  account: Account,
  acctTxs: Transaction[],
  from: string,
  to: string,
  samples = 40,
): number[] {
  const asOf = today()
  const end = to < asOf ? to : asOf         // gelecek gün-sonu yok
  if (from > end) return [account.balance, account.balance]

  const posted = excludeFuture(acctTxs, asOf)
    .slice()
    .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))

  // Dönem başından ÖNCEKI birikmiş kuruş etkisi → başlangıç bakiyesi
  let cumMinor = toMinor(account.initialBalance)
  let i = 0
  for (; i < posted.length && posted[i].date.slice(0, 10) < from; i++) {
    cumMinor += effectMinor(account, posted[i])
  }

  // from..end arası eşit örnek günleri
  const fromT = Date.parse(from + 'T00:00:00Z')
  const endT = Date.parse(end + 'T00:00:00Z')
  const span = Math.max(endT - fromT, 0)
  const n = Math.max(2, Math.min(samples, Math.floor(span / 86_400_000) + 1))

  const series: number[] = []
  for (let k = 0; k < n; k++) {
    const dayT = fromT + Math.round((span * k) / (n - 1))
    const dayIso = new Date(dayT).toISOString().slice(0, 10)
    for (; i < posted.length && posted[i].date.slice(0, 10) <= dayIso; i++) {
      cumMinor += effectMinor(account, posted[i])
    }
    series.push(toMajor(cumMinor))
  }
  return series
}
