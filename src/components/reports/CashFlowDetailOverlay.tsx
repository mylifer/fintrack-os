'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { TransactionList } from '@/components/transactions/TransactionList'
import { formatCurrency } from '@/lib/utils/currency'
import { isInRange } from '@/lib/utils/date'
import { baseAmount } from '@/lib/utils/fx'
import { sumBy } from '@/lib/utils/money'
import type { Transaction } from '@/types'

type TypeFilter = 'all' | 'income' | 'expense'

interface Props {
  open: boolean
  /** Kapsanan tarih aralığı (yyyy-MM-dd). */
  from: string
  to: string
  /** Başlık üstü etiket — "Bu Ay", "12 May" gibi kova/dönem adı. */
  label: string
  /**
   * Dönem + hesap filtreli, mutabakat ayıklanmış İŞLENMİŞ işlemler (page'in
   * `filteredTxs`'i). Overlay kendi içinde aralığa ve tipe göre daraltır —
   * gelir/gider dışındaki satırlar (transfer) nakit akışının parçası değildir.
   */
  transactions: Transaction[]
  onClose: () => void
}

const TABS: { key: TypeFilter; label: string }[] = [
  { key: 'all',     label: 'Tümü' },
  { key: 'income',  label: 'Gelir' },
  { key: 'expense', label: 'Gider' },
]

export function CashFlowDetailOverlay({ open, from, to, label, transactions, onClose }: Props) {
  const [tab, setTab] = useState<TypeFilter>('all')

  // Giriş/çıkış animasyonu: render (DOM'da mı) + show (animasyon konumu) ayrık.
  // Tüm setState çağrıları rAF/timeout içine ertelenir (effect gövdesinde senkron
  // setState yok). open→ önce mount + filtre sıfırla, sonraki frame'de kaydır;
  // close→ geri kaydır, 300ms sonra unmount et.
  const [render, setRender] = useState(open)
  const [show, setShow]     = useState(false)

  useEffect(() => {
    if (open) {
      let inner = 0
      const outer = requestAnimationFrame(() => {
        setRender(true)
        setTab('all')
        inner = requestAnimationFrame(() => setShow(true))
      })
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
    }
    const raf = requestAnimationFrame(() => setShow(false))
    const t = setTimeout(() => setRender(false), 300)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Aralık içindeki gelir+gider satırları (transfer hariç — nakit akışıyla aynı kapsam).
  const inRange = useMemo(
    () => transactions.filter(t =>
      (t.type === 'income' || t.type === 'expense') && isInRange(t.date, from, to),
    ),
    [transactions, from, to],
  )

  const totals = useMemo(() => {
    const income  = sumBy(inRange.filter(t => t.type === 'income'),  baseAmount)
    const expense = sumBy(inRange.filter(t => t.type === 'expense'), baseAmount)
    return { income, expense, net: income - expense }
  }, [inRange])

  const shown = useMemo(
    () => tab === 'all' ? inRange : inRange.filter(t => t.type === tab),
    [inRange, tab],
  )

  const rangeLabel = useMemo(() => {
    try {
      const f = format(parseISO(from), 'd MMM', { locale: tr })
      const t = format(parseISO(to),   'd MMM yyyy', { locale: tr })
      return f === format(parseISO(to), 'd MMM', { locale: tr }) ? t : `${f} – ${t}`
    } catch { return '' }
  }, [from, to])

  if (!render) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Panel — sağdan kayar */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-2xl flex flex-col border-l border-border transition-transform duration-300 ease-out ${show ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground truncate">Nakit Akışı Detayı</h2>
              <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-muted/50 text-muted-foreground rounded flex-shrink-0">
                {label}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{rangeLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        {/* Özet şeridi */}
        <div className="grid grid-cols-3 divide-x divide-border/60 border-b border-border flex-shrink-0">
          <SummaryCell
            icon={<ArrowUpRight size={13} className="text-green-600" />}
            label="Gelir"
            value={formatCurrency(totals.income)}
            valueClass="text-green-600"
          />
          <SummaryCell
            icon={<ArrowDownLeft size={13} className="text-destructive" />}
            label="Gider"
            value={formatCurrency(totals.expense)}
            valueClass="text-destructive"
          />
          <SummaryCell
            label="Net"
            value={`${totals.net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(totals.net))}`}
            valueClass={totals.net >= 0 ? 'text-green-600' : 'text-destructive'}
          />
        </div>

        {/* Tip sekmeleri */}
        <div className="px-6 py-3 border-b border-border/60 flex-shrink-0">
          <div className="flex gap-0.5 bg-background p-1 rounded-xl w-fit">
            {TABS.map(t => {
              const count = t.key === 'all'
                ? inRange.length
                : inRange.filter(x => x.type === t.key).length
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={[
                    'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap',
                    tab === t.key ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {t.label}
                  <span className="ml-1.5 opacity-60 tabular-nums">{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* İşlem listesi */}
        <div className="flex-1 overflow-y-auto">
          <TransactionList
            transactions={shown}
            showAccount
            emptyTitle="İşlem bulunamadı"
            emptyDescription="Bu aralıkta gösterilecek işlem yok."
          />
        </div>
      </div>
    </div>
  )
}

function SummaryCell({
  icon, label, value, valueClass,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="px-4 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`text-sm font-medium tabular-nums truncate ${valueClass ?? 'text-foreground'}`}>
        {value}
      </div>
    </div>
  )
}
