'use client'

import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { Icon, IC } from '@/components/layout/sidebar/icons'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { shiftMonth, type MonthKey, type PaymentRow, type PaymentTarget } from '@/lib/payments/schedule'

/* Ödeme takibi görünümlerinin paylaştığı küçük parçalar: ay başlıkları, durum
   rozeti ve renkleri, hedef işareti, tutar notları, segment/ay seçicileri.
   Dört görünüm aynı rengi aynı durum için kullanır — görünüm değiştirmek
   anlamı değiştirmesin. */

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

export function monthTitle(month: MonthKey): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

export function monthShort(month: MonthKey): string {
  return MONTHS_SHORT[Number(month.slice(5, 7)) - 1]
}

export function dayMonth(iso: string): string {
  return formatDate(iso, 'd MMM')
}

export function kindLabel(target: PaymentTarget): string {
  return target.kind === 'card' ? 'Kredi kartı' : (target.debt?.counterparty || 'Borç')
}

/** Vadeye göre kısa açıklama: "3 gün kaldı", "2 gün gecikti", "12 Eyl ödendi". */
export function dueLabel(row: PaymentRow): string {
  if (row.state === 'paid') return row.paidDate ? `${dayMonth(row.paidDate)} ödendi` : 'Ödendi'
  if (row.state === 'skipped') return 'Bu ay atlandı'
  if (row.state === 'clear') return 'Ödenecek tutar yok'
  if (row.timing === 'done') return 'Takip başlangıcından önce'
  const d = row.daysLeft
  if (d < 0) return `${-d} gün gecikti`
  if (d === 0) return 'Son gün bugün'
  if (d === 1) return 'Yarın'
  return `${d} gün kaldı`
}

export interface Tone {
  label: string
  /** Rozet zemini + metni */
  pill: string
  /** Şerit / nokta dolgusu */
  bar: string
  text: string
}

export function rowTone(row: PaymentRow): Tone {
  switch (row.state) {
    case 'paid':
      return { label: 'Ödendi', pill: 'bg-green-600/10 text-green-600', bar: 'bg-green-500', text: 'text-green-600' }
    case 'partial':
      return row.timing === 'overdue'
        ? { label: 'Kısmi · gecikti', pill: 'bg-destructive/10 text-destructive', bar: 'bg-destructive', text: 'text-destructive' }
        : { label: 'Kısmi', pill: 'bg-amber-500/15 text-amber-600', bar: 'bg-amber-500', text: 'text-amber-600' }
    case 'skipped':
      return { label: 'Atlandı', pill: 'bg-secondary text-muted-foreground', bar: 'bg-muted-foreground/30', text: 'text-muted-foreground' }
    case 'clear':
      return { label: 'Borç yok', pill: 'bg-secondary text-muted-foreground', bar: 'bg-muted-foreground/30', text: 'text-muted-foreground' }
  }
  switch (row.timing) {
    case 'overdue':
      return { label: 'Gecikti', pill: 'bg-destructive/10 text-destructive', bar: 'bg-destructive', text: 'text-destructive' }
    case 'today':
      return { label: 'Bugün', pill: 'bg-orange-500/15 text-orange-600', bar: 'bg-orange-500', text: 'text-orange-600' }
    case 'soon':
      return { label: 'Yaklaşıyor', pill: 'bg-sky-500/10 text-sky-600', bar: 'bg-sky-500', text: 'text-sky-600' }
    case 'later':
      return { label: 'Bekliyor', pill: 'bg-secondary text-foreground/80', bar: 'bg-foreground/25', text: 'text-muted-foreground' }
    default:
      return { label: 'Takip dışı', pill: 'bg-secondary text-muted-foreground', bar: 'bg-muted-foreground/30', text: 'text-muted-foreground' }
  }
}

export function StatusPill({ row }: { row: PaymentRow }) {
  const tone = rowTone(row)
  return (
    <span className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-semibold whitespace-nowrap ${tone.pill}`}>
      {tone.label}
      {row.paidVia === 'detected' && (
        <span
          className="font-medium opacity-75"
          title={row.target.kind === 'card'
            ? 'Karta yapılmış transferden otomatik bulundu'
            : 'Bu borca bağlı ödeme işleminden otomatik bulundu'}
        >
          · oto
        </span>
      )}
    </span>
  )
}

/** Kartta hesabın avatarı, borçta nötr para ikonu. */
export function TargetMark({ target, size = 'sm' }: { target: PaymentTarget; size?: 'xs' | 'sm' | 'md' }) {
  if (target.account) return <AccountAvatar account={target.account} size={size} />
  const box = size === 'xs' ? 'w-5 h-5' : size === 'md' ? 'w-10 h-10' : 'w-8 h-8'
  const icon = size === 'xs' ? 12 : size === 'md' ? 20 : 16
  return (
    <div className={`${box} rounded-md flex-shrink-0 flex items-center justify-center bg-slate-500/15 text-slate-600 dark:text-slate-300`}>
      <Icon d={IC.debts} size={icon} />
    </div>
  )
}

export function fmtAmount(row: PaymentRow): string {
  return row.amount === null ? 'Tutar yok' : formatCurrency(row.amount, row.target.currency)
}

/** Tutarın altındaki küçük not: kısmi ödeme, tutar kaynağı, fazla ödeme. */
export function amountNote(row: PaymentRow): string {
  const cur = row.target.currency
  if (row.state === 'partial') {
    return `${formatCurrency(row.paidAmount, cur)} ödendi · kalan ${formatCurrency(row.remaining, cur)}`
  }
  if (row.state === 'paid') {
    return row.amount !== null && row.paidAmount !== row.amount
      ? `${formatCurrency(row.paidAmount, cur)} ödendi`
      : ''
  }
  if (row.state === 'skipped' || row.state === 'clear') return ''
  switch (row.amountSource) {
    case 'estimate': return 'ekstre tahmini'
    case 'custom':   return 'bu aya özel'
    case 'derived':  return 'aylık taksit'
    default:         return ''
  }
}

export function SumItem({
  label, value, note, className = '', strong = false,
}: {
  label: string
  value: string
  note?: string
  className?: string
  strong?: boolean
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular-nums truncate ${strong ? 'text-lg font-semibold' : 'text-sm font-semibold'} ${className}`}>
        {value}
      </span>
      {note && <span className="text-[10.5px] text-muted-foreground truncate">{note}</span>}
    </div>
  )
}

export function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { key: T; label: string; title?: string }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60 max-w-full overflow-x-auto">
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          title={o.title}
          aria-pressed={value === o.key}
          className={`px-3 h-7 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
            value === o.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MonthNav({
  month, current, onChange,
}: {
  month: MonthKey
  current: MonthKey
  onChange: (m: MonthKey) => void
}) {
  const arrow = 'size-9 flex items-center justify-center rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors'
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Önceki ay" onClick={() => onChange(shiftMonth(month, -1))} className={arrow}>‹</button>
      <div className="min-w-[124px] text-center text-sm font-semibold" aria-live="polite">{monthTitle(month)}</div>
      <button type="button" aria-label="Sonraki ay" onClick={() => onChange(shiftMonth(month, 1))} className={arrow}>›</button>
      {month !== current && (
        <button
          type="button"
          onClick={() => onChange(current)}
          className="h-9 px-3 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          Bu ay
        </button>
      )}
    </div>
  )
}

export function PayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      className="h-7 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/85 transition-colors whitespace-nowrap"
    >
      Öde
    </button>
  )
}

export function EditButton({ onClick, name }: { onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      title="Düzenle"
      aria-label={`${name} düzenle`}
      className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  )
}

/** Bu aya özel değer işareti (tarih/tutar/hesap plandan farklı). */
export function CustomDot({ title }: { title: string }) {
  return <span title={title} aria-label={title} className="inline-block size-1.5 rounded-full bg-primary align-middle ml-1.5" />
}

export function Toggle({
  checked, onChange, label, disabled = false,
}: {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      }`}
    >
      <span className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
