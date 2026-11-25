'use client'

import type { ReactNode } from 'react'
import { CalendarDays, CreditCard, Plus, ReceiptText } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { useCardStatements } from './useCardStatements'
import { indigoFont } from './indigo/font'
import type { Account } from '@/types'

/* İndigo üst bant — hesap detayının "kart ekranı". Revolut/Monzo dilinde:
   büyük bakiye, kart görseli, yuvarlak hızlı işlemler. Bilinçli olarak tek
   görünümlüdür (açık/koyu temada aynı indigo bant); sayfanın geri kalanı
   uygulama temasını izler. */

const TYPE_LABELS: Record<string, string> = {
  cash: 'Nakit', checking: 'Vadesiz', savings: 'Vadeli',
  credit_card: 'Kredi kartı', investment: 'Yatırım', loan: 'Kredi',
}

/** "₺167.937,57" → ["₺167.937", ",57"]; gizli tutar (maske) bölünmez. */
function splitCents(s: string): [string, string] {
  const i = s.lastIndexOf(',')
  return i > 0 && /^\d{2}\D*$/.test(s.slice(i + 1)) ? [s.slice(0, i), s.slice(i)] : [s, '']
}

const daysUntil = (iso: string) =>
  Math.round((new Date(iso + 'T12:00:00').getTime() - new Date(today() + 'T12:00:00').getTime()) / 86_400_000)

function QuickAction({ icon, label, onClick, primary }: {
  icon: ReactNode; label: string; onClick: () => void; primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-16 flex-col items-center gap-2 text-[13px] font-semibold text-white outline-none"
    >
      <span
        className={`flex size-[52px] items-center justify-center rounded-full transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-3 group-focus-visible:ring-white/60 [&_svg]:size-5 ${
          primary ? 'bg-[#5b4cff] shadow-[0_8px_20px_-6px_rgba(91,76,255,.8)]' : 'bg-white/14'
        }`}
      >
        {icon}
      </span>
      {label}
    </button>
  )
}

/** Kartın son ekstre / kesim satırı — useCardStatements yalnız kredi kartında
 *  çağrılsın diye ayrı bileşen. */
function CardDueLine({ account }: { account: Account }) {
  const { result } = useCardStatements(account)
  const last = result.statements[0]
  const money = (n: number) => formatCurrency(n, account.currency)
  const unpaid = last && last.dueDate && (last.status === 'open' || last.status === 'partial' || last.status === 'overdue')
  if (unpaid) {
    const d = daysUntil(last.dueDate!)
    const left = Math.max(0, last.total - last.paid)
    return (
      <>
        {d < 0 ? `Son ödeme ${-d} gün geçti` : d === 0 ? 'Son ödeme bugün' : `${d} gün sonra son ödeme`}
        {' '}({formatDate(last.dueDate!, 'd MMM')}) · kalan {money(left)}
      </>
    )
  }
  const cut = daysUntil(result.open.period.to)
  return (
    <>
      Bu dönem {money(result.open.total)} · {cut <= 0 ? 'bugün kesilecek' : `${cut} gün sonra kesilecek`} ({formatDate(result.open.period.to, 'd MMM')})
    </>
  )
}

export function AccountHero({
  account, balance, available, limit, usedPct,
  onAddTx, onOpenStatements, onOpenPlans, onOpenCard,
}: {
  account: Account
  /** Sayım animasyonlu mutlak bakiye */
  balance: number
  available: number | null
  limit: number
  usedPct: number
  onAddTx: () => void
  onOpenStatements: () => void
  /** Süren taksit planı yoksa düğme gösterilmez */
  onOpenPlans?: () => void
  onOpenCard: () => void
}) {
  const isCard = account.type === 'credit_card'
  const negative = account.balance < 0
  const [main, cents] = splitCents(formatCurrency(balance, account.currency))
  const usedClamped = Math.min(Math.max(usedPct, 0), 100)
  const barColor = usedPct > 80 ? 'bg-[#ff5c7a]' : 'bg-[#7b6dff]'
  const cardBg = isCard
    ? 'linear-gradient(135deg,#111216,#2b2d36)'
    : `linear-gradient(135deg,${account.color || '#2b2f8f'},#1b1f6b)`

  return (
    <section
      className={`${indigoFont.className} flex-shrink-0 bg-[#1b1f6b] text-white`}
      style={{ backgroundImage: 'radial-gradient(1100px 480px at 85% -10%, #4b2bd6, transparent 60%)' }}
      aria-label={`${account.name} özeti`}
    >
      <div className="mx-auto grid max-w-[1160px] items-center gap-8 px-4 sm:px-6 py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
            <span className="truncate">{account.name}</span>
            <span aria-hidden="true">·</span>
            <span>{TYPE_LABELS[account.type] ?? account.type}</span>
          </div>

          <div
            className="mt-2.5 mb-1.5 font-extrabold leading-none tracking-[-0.03em] tabular-nums text-[clamp(40px,6.5vw,68px)]"
            aria-label={`${isCard ? 'Güncel borç' : 'Bakiye'} ${negative ? 'eksi ' : ''}${formatCurrency(Math.abs(account.balance), account.currency)}`}
          >
            {negative ? '−' : ''}{main}<span className="ml-0.5 text-[0.45em] font-bold opacity-80">{cents}</span>
          </div>
          <p className="text-[15px] text-white/70">
            {isCard ? <>Güncel borç · <CardDueLine account={account} /></> : 'Güncel bakiye'}
          </p>

          {isCard && limit > 0 && available !== null && (
            <div className="mt-5 flex max-w-md flex-col gap-2">
              <div
                className="h-2.5 overflow-hidden rounded-full bg-white/15"
                role="progressbar"
                aria-label="Limit kullanımı"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usedClamped)}
              >
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${usedClamped}%` }} />
              </div>
              <div className="flex justify-between gap-3 text-sm text-white/70">
                <span>Kullanılabilir <b className="font-bold text-white tabular-nums">{formatCurrency(available, account.currency)}</b></span>
                <span className="tabular-nums">Limit {formatCurrency(limit, account.currency)}</span>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-4">
            <QuickAction primary icon={<Plus />} label="İşlem ekle" onClick={onAddTx} />
            {isCard && <QuickAction icon={<ReceiptText />} label="Ekstreler" onClick={onOpenStatements} />}
            {onOpenPlans && <QuickAction icon={<CalendarDays />} label="Taksitler" onClick={onOpenPlans} />}
            <QuickAction icon={<CreditCard />} label={isCard ? 'Kart' : 'Hesap'} onClick={onOpenCard} />
          </div>
        </div>

        {/* Kart görseli — dekor; içindeki bilgi solda zaten yazılı. Telefonda
            gizli: ilk ekranı kaplayıp listeyi aşağı itiyordu. */}
        <div
          aria-hidden="true"
          className="relative mx-auto max-md:hidden flex aspect-[1.586] w-full max-w-[400px] -rotate-3 flex-col justify-between overflow-hidden rounded-[22px] p-6 shadow-[0_30px_60px_-20px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.22)] max-lg:max-w-[340px] max-lg:rotate-0"
          style={{ backgroundImage: cardBg }}
        >
          <div
            className="pointer-events-none absolute inset-0 motion-safe:animate-[hero-shine_6s_ease-in-out_infinite]"
            style={{ backgroundImage: 'linear-gradient(120deg,transparent 30%,rgba(160,140,255,.32) 50%,transparent 70%)', backgroundSize: '250% 100%' }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xl font-extrabold tracking-tight">{account.name}</div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-80">{TYPE_LABELS[account.type] ?? account.type}</div>
            </div>
            {isCard && (
              <div className="h-[34px] w-11 flex-none rounded-[7px] bg-gradient-to-br from-[#f6d98b] to-[#c9a24a] shadow-[inset_0_0_0_1px_rgba(0,0,0,.15)]" />
            )}
          </div>
          <div className="relative flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs opacity-80">{isCard ? 'Kullanılabilir' : 'Bakiye'}</div>
              <div className="truncate text-lg font-bold tabular-nums">
                {isCard && available !== null
                  ? formatCurrency(available, account.currency)
                  : `${negative ? '−' : ''}${formatCurrency(Math.abs(account.balance), account.currency)}`}
              </div>
            </div>
            <div className="text-sm font-bold tracking-[0.14em] opacity-80">{account.currency}</div>
          </div>
        </div>
      </div>
    </section>
  )
}
