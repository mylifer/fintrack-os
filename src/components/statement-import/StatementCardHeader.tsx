'use client'

import type { ReactNode } from 'react'
import { AccountAvatar, getBankBrand } from '@/components/accounts/AccountAvatar'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { StatementDraft } from '@/store/statement-drafts.store'
import type { Account } from '@/types'

/* Yüklenen / yarım kalan ekstre kutularının ortak başlığı: banka ikonu, başlık
   ve sağda büyük yazıyla ekstrenin (ya da dönem içi listenin) kapsadığı son tarih. */

/** Dönem önceki kesimin ertesi günü başlar (özet ekranıyla aynı) */
const nextDay = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + 1)).toISOString().slice(0, 10)

/** Ekstrenin kapsadığı tarih aralığı: vadesiz dökümde dönem, kartta önceki
 *  kesimin ertesi → kesim; satır tarihleri aralığın dışına taşıyorsa genişletilir. */
export function statementRange(d: Pick<StatementDraft, 'statement'>): { start: string; end: string } {
  const st = d.statement
  const dates = st.lines.map(l => l.date).filter((x): x is string => !!x).sort()
  let start = st.account?.periodStart ?? (st.prevStatementDate ? nextDay(st.prevStatementDate) : dates[0] ?? st.statementDate)
  let end = st.account?.periodEnd ?? st.statementDate
  if (dates.length) {
    if (dates[0] < start) start = dates[0]
    if (dates[dates.length - 1] > end) end = dates[dates.length - 1]
  }
  return { start, end }
}

export function statementTitle(d: Pick<StatementDraft, 'statement'>): string {
  const st = d.statement
  return `${st.bankLabel} ${st.mapped ? (st.type === 'checking' ? '· hesap dökümü' : '· kart işlemleri') : st.type === 'checking' ? 'vadesiz hesap dökümü' : st.provisional ? 'dönem içi işlemler' : 'kredi kartı ekstresi'}`
}

type AvatarAccount = Pick<Account, 'name' | 'color' | 'icon'>

/** Ekstrenin bankasının ikonu; banka tanınmıyorsa (elle eşlenen ekstre) hesabın ikonu */
export function StatementBankIcon({ draft, account, size = 'md' }: { draft: Pick<StatementDraft, 'statement'>; account?: AvatarAccount; size?: 'sm' | 'md' | 'lg' }) {
  const label = draft.statement.bankLabel
  const brand = getBankBrand(label)
  // Banka tanınıyorsa marka rengiyle banka rozeti (çevrimiçi logo kapalıyken de
  // tanınır); tanınmıyorsa (elle eşlenen ekstre) hesabın kendi ikonu.
  const avatar = brand || !account ? { name: label, color: brand?.color ?? '#64748b' } : account
  return <AccountAvatar account={avatar} size={size} />
}

export function StatementCardHeader({ draft, account, lines }: { draft: StatementDraft; account?: AvatarAccount; lines: ReactNode }) {
  const st = draft.statement
  const { start, end } = statementRange(draft)
  const hasAmount = !!(st.summary || (st.account && (!st.mapped || st.mapped.hasBalance)))
  return (
    <div className="flex items-start gap-3">
      <StatementBankIcon draft={draft} account={account} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-snug line-clamp-2 group-hover:underline underline-offset-2">{statementTitle(draft)}</div>
        {lines}
      </div>
      <div className="flex-shrink-0 text-right tabular-nums">
        <div className="text-[11px] text-muted-foreground leading-none">{start !== end ? `${formatDate(start, 'd MMM')} –` : 'Tarih'}</div>
        <div className="mt-1 whitespace-nowrap leading-none" title={`${formatDate(start, 'd MMM yyyy')} – ${formatDate(end, 'd MMM yyyy')}`}>
          <span className="text-xl font-semibold tracking-tight">{formatDate(end, 'd MMM')}</span>
          <span className="text-xs text-muted-foreground ml-1">{end.slice(0, 4)}</span>
        </div>
        {hasAmount && <div className="text-sm font-medium text-muted-foreground mt-1.5 whitespace-nowrap">{formatCurrency(st.summary?.debt ?? st.account!.closingBalance)}</div>}
      </div>
    </div>
  )
}
