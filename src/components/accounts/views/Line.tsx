'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Klasik ama cilalı hesap satırı — Liste / Bölümler / Genel Bakış görünümlerinin
 * ortak yapı taşı. Sol renkli avatar, ad + tür (kredi kartında kullanılabilir),
 * sağda bakiye + dönem net değişimi; hover'da Düzenle.
 */
export function AccountLine({ row, onEdit }: { row: AccountRow; onEdit: (a: Account) => void }) {
  const { account, available, income, expense } = row
  const periodNet = income - expense
  const isCredit = account.type === 'credit_card' && !!account.creditLimit

  return (
    <div className="group relative flex items-center gap-3.5 px-4 h-[68px] transition-colors hover:bg-secondary/40">
      {/* Gerilmiş bağlantı — satırın her yeri hesap detayına gider */}
      <Link
        href={`/accounts/${account.id}`}
        aria-label={`${account.name} hesap detayı`}
        className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset"
      />

      <AccountAvatar account={account} size="md" />

      <div className="min-w-0 flex-1">
        <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate block">
          {account.name}
        </span>
        <div className="text-xs text-muted-foreground truncate">
          {TYPE_LABELS[account.type]}
          {isCredit && available !== null && (
            <> · <AnimatedNumber value={available} format={v => formatCompact(v, account.currency)} /> kullanılabilir</>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className={`text-sm font-semibold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
          <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
        </div>
        {periodNet !== 0 && (income > 0 || expense > 0) && (
          <div className={`text-xs font-medium tabular-nums ${periodNet >= 0 ? 'text-green-600' : 'text-destructive'}`}>
            {periodNet >= 0 ? '+' : '−'}<AnimatedNumber value={Math.abs(periodNet)} format={v => formatCompact(v, account.currency)} />
            <span className="text-muted-foreground font-normal"> bu dönem</span>
          </div>
        )}
      </div>

      <button
        onClick={() => onEdit(account)}
        className="relative z-20 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-secondary flex-shrink-0"
      >
        Düzenle
      </button>

      {/* CTA — hesap detayı */}
      <Button
        asChild
        size="xs"
        variant="secondary"
        rightIcon={<ArrowRight className="size-3" />}
        className="relative z-20 font-semibold group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <Link href={`/accounts/${account.id}`}>Detay</Link>
      </Button>
    </div>
  )
}
