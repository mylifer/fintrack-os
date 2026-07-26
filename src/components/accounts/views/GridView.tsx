'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency, formatCompact } from '@/lib/utils/currency'
import { TYPE_LABELS, barColor, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm — Izgara
 * Duyarlı, zarif kart ızgarası. Üstte hesap renginde ince vurgu şeridi, büyük
 * bakiye, altta dönem gelir/gider ya da kredi kartı limit çubuğu. Yumuşak
 * gölge/kenarlık, hover'da hafif yükselme.
 *
 * Kartın tamamı hesap detayına götürür (gerilmiş bağlantı, z-10); sağ üstteki
 * "Detay" butonu ve Düzenle z-20 ile bağlantının üstünde kalır.
 */
export function GridView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {rows.map(({ account, available, usedPct, income, expense, hasActivity }, i) => {
        const isCredit = account.type === 'credit_card' && !!account.creditLimit
        return (
          <div
            key={account.id}
            className="group relative rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            {/* Renk vurgu şeridi — her hesaba paletten farklı renk */}
            <div className="h-1 w-full" style={{ background: barColor(i) }} />

            {/* Gerilmiş bağlantı — kartın her yeri hesap detayına gider */}
            <Link
              href={`/accounts/${account.id}`}
              aria-label={`${account.name} hesap detayı`}
              className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset"
            />

            <div className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <AccountAvatar account={account} size="md" />
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate block">
                      {account.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{TYPE_LABELS[account.type]} · {account.currency}</span>
                  </div>
                </div>
                {/* Sağ üst aksiyonlar — CTA her zaman görünür, Düzenle hover'da */}
                <div className="relative z-20 flex items-center gap-1 flex-shrink-0">
                  {/* Yalnız işaretçili cihazlarda: dokunmatikte group-hover hiç
                      tetiklenmediğinden (Tailwind hover: → @media (hover:hover))
                      görünmez ama tıklanabilir bir hedef olarak kalıyordu. */}
                  <button
                    onClick={() => onEdit(account)}
                    className="hidden lg:block opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-secondary"
                  >
                    Düzenle
                  </button>
                  {/* NOT: <Button asChild> KULLANMA — Button daima 3 çocuk yuvası
                      (leftIcon/children/rightIcon) geçirir, Radix Slot ise tek
                      çocuk ister ve boş yuvaları da sayar → "Slot failed to slot
                      onto its children". Bağlantıya buttonVariants sınıfı veriyoruz. */}
                  <Link
                    href={`/accounts/${account.id}`}
                    className={cn(
                      buttonVariants({ variant: 'secondary', size: 'xs' }),
                      'font-semibold group-hover:bg-primary group-hover:text-primary-foreground',
                    )}
                  >
                    Detay
                    <ArrowRight className="size-3" />
                  </Link>
                </div>
              </div>

              <div className={`mt-4 text-2xl font-semibold tabular-nums tracking-tight ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
                <AnimatedNumber value={account.balance} format={v => formatCurrency(v, account.currency)} />
              </div>

              {isCredit ? (
                <div className="mt-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Kullanılabilir</span>
                    <span className="tabular-nums font-medium text-foreground"><AnimatedNumber value={available ?? 0} format={v => formatCurrency(v, account.currency)} /></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${usedPct > 80 ? 'bg-destructive' : usedPct > 60 ? 'bg-orange-500' : 'bg-green-600'}`} style={{ width: `${Math.min(usedPct, 100)}%` }} />
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-4 text-xs font-medium h-[18px]">
                  {hasActivity ? (
                    <>
                      {income > 0 && <span className="text-green-600 tabular-nums">+<AnimatedNumber value={income} format={formatCompact} /></span>}
                      {expense > 0 && <span className="text-destructive tabular-nums">−<AnimatedNumber value={expense} format={formatCompact} /></span>}
                      <span className="text-muted-foreground font-normal">bu dönem</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground/50">bu dönem hareket yok</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
