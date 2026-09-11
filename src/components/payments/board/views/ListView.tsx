'use client'

import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { isActionable, summarizeRows, type PaymentRow } from '@/lib/payments/schedule'
import type { Account } from '@/types'
import {
  CustomDot, EditButton, EmptyBox, PayButton, StatusPill, TargetMark,
  amountNote, dueLabel, fmtAmount, kindLabel, monthTitle, rowTone,
} from '../bits'

/* ── Liste ───────────────────────────────────────────────────────────────────
   Seçili ayın ödemeleri ACİLİYETE göre bölümlenmiş tek kolonlu tabloda:
   önceki aylardan kalan gecikmişler → bu ayın gecikmişleri → 7 gün içinde →
   ayın geri kalanı → ödenenler → atlananlar. Kolonlar bölümler arasında hizalı.
   Dar ekranda aynı bölümler istif satırlar olarak basılır (tablo sığmaz). */

interface Props {
  rows: PaymentRow[]
  carryRows: PaymentRow[]
  accounts: Account[]
  onEdit: (row: PaymentRow) => void
  onPay: (row: PaymentRow) => void
}

interface Section {
  key: string
  title: string
  rows: PaymentRow[]
  danger?: boolean
  showMonth?: boolean
  done?: boolean
}

type RowProps = {
  row: PaymentRow
  account: Account | undefined
  showMonth: boolean
  onEdit: (row: PaymentRow) => void
  onPay: (row: PaymentRow) => void
}

export function ListView({ rows, carryRows, accounts, onEdit, onPay }: Props) {
  const accountById = new Map(accounts.map(a => [a.id, a]))

  const sections: Section[] = ([
    { key: 'carry',   title: 'Önceki aylardan gecikmiş', rows: carryRows, danger: true, showMonth: true },
    { key: 'overdue', title: 'Gecikmiş', rows: rows.filter(r => isActionable(r) && r.timing === 'overdue'), danger: true },
    { key: 'soon',    title: 'Bugün ve önümüzdeki 7 gün', rows: rows.filter(r => r.timing === 'today' || r.timing === 'soon') },
    { key: 'later',   title: 'Ayın geri kalanı', rows: rows.filter(r => isActionable(r) && (r.timing === 'later' || r.timing === 'done')) },
    { key: 'paid',    title: 'Ödenenler', rows: rows.filter(r => r.state === 'paid' || r.state === 'clear'), done: true },
    { key: 'skipped', title: 'Atlananlar', rows: rows.filter(r => r.state === 'skipped'), done: true },
  ] satisfies Section[]).filter(s => s.rows.length > 0)

  if (sections.length === 0) return <EmptyBox>Bu ay için takip edilen ödeme yok.</EmptyBox>

  const rowProps = (section: Section, row: PaymentRow): RowProps & { key: string } => ({
    key: `${row.target.key}|${row.month}`,
    row,
    account: row.fromAccountId ? accountById.get(row.fromAccountId) : undefined,
    showMonth: !!section.showMonth,
    onEdit,
    onPay,
  })

  return (
    <>
      {/* ── Geniş ekran: kolonlu tablo ──
          `relative`: başlıktaki sr-only (absolute) etiket kaydırma kutusunun
          dışına kaçıp sayfayı yatay kaydırmasın. */}
      <div className="hidden sm:block relative rounded-xl border border-border/60 bg-card overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
              <th className="text-left font-semibold py-2 pl-4">Ödeme</th>
              <th className="text-left font-semibold py-2">Vade</th>
              <th className="text-left font-semibold py-2">Ödeme hesabı</th>
              <th className="text-right font-semibold py-2">Tutar</th>
              <th className="text-left font-semibold py-2 pl-6">Durum</th>
              <th className="py-2 pr-4 w-[104px]"><span className="sr-only">İşlemler</span></th>
            </tr>
          </thead>
          {sections.map(section => (
            <tbody key={section.key}>
              <tr className="bg-secondary/40">
                <td colSpan={6} className="px-4 py-1.5">
                  <SectionHeader section={section} />
                </td>
              </tr>
              {section.rows.map(row => {
                const { key, ...props } = rowProps(section, row)
                return <TableRow key={key} {...props} />
              })}
            </tbody>
          ))}
        </table>
      </div>

      {/* ── Dar ekran: istif satırlar ── */}
      <div className="sm:hidden rounded-xl border border-border/60 bg-card overflow-hidden text-sm">
        {sections.map(section => (
          <div key={section.key}>
            <div className="bg-secondary/40 px-3 py-1.5">
              <SectionHeader section={section} />
            </div>
            <ul className="divide-y divide-border/40">
              {section.rows.map(row => {
                const { key, ...props } = rowProps(section, row)
                return <StackRow key={key} {...props} />
              })}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}

function SectionHeader({ section }: { section: Section }) {
  const sum = summarizeRows(section.rows)
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold">
      <span className={section.danger ? 'text-destructive' : 'text-foreground'}>{section.title}</span>
      <span className="text-muted-foreground tabular-nums">{section.rows.length}</span>
      <span className="ml-auto tabular-nums text-muted-foreground font-medium">
        {section.done
          ? `${formatCurrency(sum.paidTry)} ödendi`
          : `${formatCurrency(sum.remainingTry)} ödenecek`}
      </span>
    </div>
  )
}

function TableRow({ row, account, showMonth, onEdit, onPay }: RowProps) {
  const tone = rowTone(row)
  const muted = !isActionable(row)
  const note = amountNote(row)

  return (
    <tr
      onClick={() => onEdit(row)}
      className="border-b border-border/40 last:border-b-0 hover:bg-secondary/40 cursor-pointer transition-colors"
    >
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <TargetMark target={row.target} size="sm" />
          <div className="min-w-0">
            <div className={`font-medium truncate ${muted ? 'text-muted-foreground' : ''}`}>{row.target.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {kindLabel(row.target)}{showMonth ? ` · ${monthTitle(row.month)}` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="py-2.5 pr-3 whitespace-nowrap">
        <div className="tabular-nums">
          {formatDate(row.dueDate, 'd MMM EEE')}
          {row.custom.dueDate && <CustomDot title="Bu aya özel tarih" />}
        </div>
        <div className={`text-[11px] ${tone.text}`}>{dueLabel(row)}</div>
      </td>
      <td className="py-2.5 pr-3">
        {account ? (
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar account={account} size="xs" />
            <span className="truncate">{account.name}</span>
            {row.custom.fromAccount && <CustomDot title="Bu aya özel hesap" />}
          </div>
        ) : (
          <span className="text-[12px] text-amber-600">Seçilmedi</span>
        )}
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">
        <div className={`tabular-nums ${row.amount === null ? 'text-muted-foreground' : 'font-semibold'} ${muted ? 'text-muted-foreground' : ''}`}>
          {fmtAmount(row)}
        </div>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </td>
      <td className="py-2.5 pl-6 pr-3"><StatusPill row={row} /></td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center justify-end gap-1">
          {isActionable(row) && <PayButton onClick={() => onPay(row)} />}
          <EditButton onClick={() => onEdit(row)} name={row.target.name} />
        </div>
      </td>
    </tr>
  )
}

function StackRow({ row, account, showMonth, onEdit, onPay }: RowProps) {
  const tone = rowTone(row)
  const muted = !isActionable(row)
  const note = amountNote(row)

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onEdit(row)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(row) } }}
      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer active:bg-secondary/60"
    >
      <TargetMark target={row.target} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-medium truncate ${muted ? 'text-muted-foreground' : ''}`}>{row.target.name}</span>
          <span className={`tabular-nums whitespace-nowrap ${row.amount === null || muted ? 'text-muted-foreground' : 'font-semibold'}`}>
            {fmtAmount(row)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={`truncate ${tone.text}`}>
            {formatDate(row.dueDate, 'd MMM')} · {dueLabel(row)}{showMonth ? ` · ${monthTitle(row.month)}` : ''}
          </span>
          <span className={`truncate ${account ? 'text-muted-foreground' : 'text-amber-600'}`}>
            {account?.name ?? 'Hesap seçilmedi'}
          </span>
        </div>
        {note && <div className="text-[11px] text-muted-foreground truncate">{note}</div>}
      </div>
      {isActionable(row) ? <PayButton onClick={() => onPay(row)} /> : <StatusPill row={row} />}
    </li>
  )
}
