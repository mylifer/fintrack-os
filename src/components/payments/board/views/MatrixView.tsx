'use client'

import { useMemo } from 'react'
import { formatWhole } from '@/lib/utils/currency'
import { toBaseTry } from '@/lib/utils/fx'
import { sumBy } from '@/lib/utils/money'
import { monthOf, summarizeRows, type MonthKey, type PaymentRow, type PaymentTarget } from '@/lib/payments/schedule'
import type { Account } from '@/types'
import { TargetMark, monthShort, monthTitle, rowTone } from '../bits'

/* ── Yıllık Plan ─────────────────────────────────────────────────────────────
   Satır = kart/borç, sütun = ay (seçili ayın 3 ay öncesinden 8 ay sonrasına).
   Hücre o ayın tutarını, vade gününü ve durumunu gösterir; tıklanınca o ayın
   düzenleme penceresi açılır. "Her ay istediğim gibi" düzenleme işinin ana
   yüzeyi budur: bir bakışta hangi aylara özel değer girildiği (turkuaz nokta)
   görünür. Satır adına tıklamak kartın/borcun varsayılanlarını açar.
   Geçmiş aylarda bulunan ödemeler (karta transfer, "Kredi Kartı Ödemesi") ödenen
   tutarla işlenir — tutar girilmemiş olsa bile. */

interface Props {
  months: MonthKey[]
  selectedMonth: MonthKey
  currentMonth: MonthKey
  targets: PaymentTarget[]
  rows: PaymentRow[]
  accounts: Account[]
  /** Ödeme günü girilmemiş kartlarda bulunan geçmiş ödeme sayısı (target.key). */
  detectedCounts: Record<string, number>
  onEdit: (row: PaymentRow) => void
  onSelectMonth: (month: MonthKey) => void
  onSettings: (target: PaymentTarget) => void
}

const cellWorth = (r: PaymentRow) =>
  r.state === 'skipped' ? 0 : toBaseTry(Math.max(r.amount ?? 0, r.paidAmount), r.target.currency)

export function MatrixView({
  months, selectedMonth, currentMonth, targets, rows, accounts, detectedCounts, onEdit, onSelectMonth, onSettings,
}: Props) {
  const byKey = useMemo(() => new Map(rows.map(r => [`${r.target.key}|${r.month}`, r])), [rows])
  const monthTotals = useMemo(
    () => months.map(m => summarizeRows(rows.filter(r => r.month === m))),
    [months, rows],
  )

  if (targets.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
        Takip edilen kart ya da borç yok.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-xl border border-border/60 bg-card overflow-x-auto">
        <table className="text-sm border-separate border-spacing-0 w-full">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card text-left pl-4 pr-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border/60 min-w-[200px]">
                Kart / Borç
              </th>
              {months.map(m => (
                <th key={m} className={`px-1 py-1.5 border-b border-border/60 ${m === selectedMonth ? 'bg-primary/10' : ''}`}>
                  <button
                    type="button"
                    onClick={() => onSelectMonth(m)}
                    aria-pressed={m === selectedMonth}
                    title={`${monthTitle(m)} — özet ve diğer görünümler bu aya geçer`}
                    className="w-full flex flex-col items-center leading-tight rounded-md py-0.5 hover:bg-secondary transition-colors"
                  >
                    <span className={`text-[11px] font-semibold ${m === currentMonth ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {monthShort(m)}
                      {m === currentMonth && <span className="inline-block size-1 rounded-full bg-primary align-middle ml-1" />}
                    </span>
                    <span className="text-[9.5px] text-muted-foreground tabular-nums">{m.slice(0, 4)}</span>
                  </button>
                </th>
              ))}
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border/60 whitespace-nowrap">
                Toplam
              </th>
            </tr>
          </thead>

          <tbody>
            {targets.map(t => {
              const cells = months.map(m => byKey.get(`${t.key}|${m}`) ?? null)
              const total = sumBy(cells.filter((r): r is PaymentRow => r !== null), cellWorth)
              const from = accounts.find(a => a.id === t.defaultFromAccountId)?.name
              const found = detectedCounts[t.key] ?? 0
              return (
                <tr key={t.key}>
                  <td className="sticky left-0 z-10 bg-card pl-4 pr-3 py-2 border-b border-border/40">
                    <button
                      type="button"
                      onClick={() => onSettings(t)}
                      title="Varsayılan tutar, gün ve hesabı düzenle"
                      className="flex items-center gap-2.5 text-left min-w-0 max-w-[220px] group"
                    >
                      <TargetMark target={t} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-medium truncate group-hover:underline underline-offset-2">{t.name}</span>
                        {t.dayOfMonth !== null ? (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            Ayın {t.dayOfMonth}. günü · {from ?? 'hesap seçilmedi'}
                          </span>
                        ) : (
                          <span className="block text-[11px] text-amber-600 truncate">Ödeme günü girilmedi</span>
                        )}
                      </span>
                    </button>
                  </td>
                  {t.needsSetup ? (
                    // Kartta gün varsayılmaz: gün girilene kadar aylar boş, tek kurulum düğmesi.
                    // Bulunan geçmiş ödemeler sayılır — gün girilince aylara işlenir.
                    <td colSpan={months.length} className="p-1 border-b border-border/40">
                      <button
                        type="button"
                        onClick={() => onSettings(t)}
                        className="w-full h-[54px] rounded-lg border border-dashed border-amber-500/50 text-[12.5px] font-semibold text-amber-600 hover:bg-amber-500/10 transition-colors"
                      >
                        {found > 0
                          ? `${found} geçmiş kart ödemesi bulundu — son ödeme gününü gir, aylara işlensin`
                          : 'Son ödeme gününü gir — aylar görünsün'}
                      </button>
                    </td>
                  ) : cells.map((r, i) => (
                    <td key={months[i]} className={`p-1 border-b border-border/40 ${months[i] === selectedMonth ? 'bg-primary/5' : ''}`}>
                      {r ? (
                        <Cell row={r} onClick={() => onEdit(r)} />
                      ) : (
                        <div
                          className="h-[54px] min-w-[96px] flex items-center justify-center text-muted-foreground/40 text-xs"
                          title="Bu ay takip edilmiyor"
                        >
                          —
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="px-3 text-right tabular-nums font-semibold border-b border-border/40 whitespace-nowrap">
                    {formatWhole(total)}
                  </td>
                </tr>
              )
            })}
          </tbody>

          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-card pl-4 pr-3 py-2 leading-tight">
                <span className="block text-[11px] font-semibold">Aylık toplam</span>
                <span className="block text-[10.5px] text-muted-foreground">kalan</span>
              </td>
              {monthTotals.map((s, i) => (
                <td key={months[i]} className={`px-1 py-2 text-center leading-tight ${months[i] === selectedMonth ? 'bg-primary/5' : ''}`}>
                  <span className="block tabular-nums text-[12px] font-semibold">{formatWhole(s.totalTry)}</span>
                  <span className={`block tabular-nums text-[10.5px] ${s.overdueCount ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    {s.remainingTry > 0 ? formatWhole(s.remainingTry) : '—'}
                  </span>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <Legend />
    </div>
  )
}

function shortState(row: PaymentRow): string {
  switch (row.state) {
    case 'paid': return '✓'
    case 'partial': return 'kısmi'
    case 'skipped': return 'atlandı'
    case 'clear': return 'boş'
  }
  switch (row.timing) {
    case 'overdue': return `${-row.daysLeft}g gecikti`
    case 'today': return 'bugün'
    case 'soon': return `${row.daysLeft}g`
    default: return ''
  }
}

/** Hücre tutarı: girilen tutar; tutar girilmemiş ama ödeme bulunmuşsa ödenen. */
function cellAmount(row: PaymentRow): string {
  if (row.state === 'clear') return '—'
  if (row.amount !== null) return formatWhole(row.amount, row.target.currency)
  if (row.paidAmount > 0) return formatWhole(row.paidAmount, row.target.currency)
  return 'Tutar gir'
}

function Cell({ row, onClick }: { row: PaymentRow; onClick: () => void }) {
  const tone = rowTone(row)
  const custom = row.custom.amount || row.custom.dueDate || row.custom.fromAccount
  const quiet = row.state === 'skipped' || row.state === 'clear'
  const dueMonth = monthOf(row.dueDate)
  const detail = row.paidVia === 'detected'
    ? ` · ${formatWhole(row.paidAmount, row.target.currency)} ödeme bulundu`
    : ''
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${row.target.name} · ${monthTitle(row.month)} — ${tone.label}${detail}`}
      className="relative w-full min-w-[96px] h-[54px] rounded-lg bg-secondary/40 hover:bg-secondary px-2 pt-1.5 pb-2 text-left overflow-hidden transition-colors"
    >
      <span className={`block tabular-nums text-[12.5px] font-semibold truncate ${quiet ? 'text-muted-foreground' : ''}`}>
        {cellAmount(row)}
      </span>
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <span className="tabular-nums">
          {Number(row.dueDate.slice(8, 10))}{dueMonth !== row.month ? ` ${monthShort(dueMonth)}` : ''}
        </span>
        <span className={`ml-auto font-semibold truncate ${tone.text}`}>{shortState(row)}</span>
      </span>
      <span className={`absolute inset-x-0 bottom-0 h-[3px] ${tone.bar}`} />
      {custom && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" aria-label="Bu aya özel değer" />}
    </button>
  )
}

function Legend() {
  const items: [string, string][] = [
    ['bg-green-500', 'Ödendi'],
    ['bg-amber-500', 'Kısmi'],
    ['bg-destructive', 'Gecikti'],
    ['bg-orange-500', 'Bugün'],
    ['bg-sky-500', '7 gün içinde'],
    ['bg-foreground/25', 'Bekliyor'],
    ['bg-muted-foreground/30', 'Atlandı / boş'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={`w-3 h-[3px] rounded-full ${cls}`} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-primary" />
        Bu aya özel değer
      </span>
    </div>
  )
}
