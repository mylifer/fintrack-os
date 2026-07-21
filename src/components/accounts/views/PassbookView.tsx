'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { AccountAvatar } from '@/components/accounts/AccountAvatar'
import { formatCurrency } from '@/lib/utils/currency'
import { TYPE_LABELS, isLiability, type AccountRow } from './shared'
import type { Account } from '@/types'

/**
 * Görünüm — Defter (Passbook)
 * Banka cüzdanı/hesap defteri estetiği: çizgili kağıt zemin, daktilo (mono)
 * yazı, isim ile tutar arası noktalı ayraç, varlık/borç bölümleri + yürüyen
 * TOPLAM ve kaşe. Nostaljik, "resmî döküm" hissi.
 */
export function PassbookView({ rows, onEdit }: { rows: AccountRow[]; onEdit: (a: Account) => void }) {
  const { assets, debts, net } = useMemo(() => {
    const assets = rows.filter(r => !isLiability(r.account.type)).sort((a, b) => b.tryBalance - a.tryBalance)
    const debts  = rows.filter(r => isLiability(r.account.type)).sort((a, b) => a.tryBalance - b.tryBalance)
    const net    = rows.reduce((s, r) => s + r.tryBalance, 0)
    return { assets, debts, net }
  }, [rows])

  const assetTotal = assets.reduce((s, r) => s + r.tryBalance, 0)
  const debtTotal  = debts.reduce((s, r) => s + r.tryBalance, 0)

  return (
    <div className="max-w-2xl mx-auto">
      <div
        className="rounded-lg border border-border shadow-sm overflow-hidden font-mono"
        style={{
          background:
            'repeating-linear-gradient(to bottom, var(--card) 0px, var(--card) 43px, color-mix(in oklch, var(--border) 55%, transparent) 43px, color-mix(in oklch, var(--border) 55%, transparent) 44px)',
        }}
      >
        {/* Cüzdan başlığı */}
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-double border-border bg-secondary/50">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Hesap Cüzdanı</div>
            <div className="text-sm font-bold text-foreground tracking-tight">HESAP DÖKÜMÜ</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net Bakiye</div>
            <div className={`text-lg font-bold tabular-nums ${net < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {formatCurrency(net)}
            </div>
          </div>
        </div>

        <div className="px-5 py-2">
          <Section title="VARLIKLAR" rows={assets} total={assetTotal} onEdit={onEdit} />
          {debts.length > 0 && <Section title="YÜKÜMLÜLÜKLER" rows={debts} total={debtTotal} onEdit={onEdit} debt />}
        </div>

        {/* Alt toplam + kaşe */}
        <div className="flex items-center justify-between px-5 py-4 border-t-2 border-double border-border bg-secondary/40">
          <span className="inline-flex items-center gap-2 rotate-[-6deg] rounded border-2 border-primary/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary/70">
            ✓ Onaylı Döküm
          </span>
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-2">Genel Toplam</span>
            <span className={`text-xl font-bold tabular-nums ${net < 0 ? 'text-destructive' : 'text-foreground'}`}>
              {formatCurrency(net)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, rows, total, debt, onEdit }: {
  title: string; rows: AccountRow[]; total: number; debt?: boolean; onEdit: (a: Account) => void
}) {
  if (rows.length === 0) return null
  return (
    <div className="py-1">
      <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground pt-2 pb-1">{title}</div>
      {rows.map(({ account }) => (
        <div key={account.id} className="group flex items-center gap-2 h-[43px]">
          <AccountAvatar account={account} size="xs" />
          <Link href={`/accounts/${account.id}`} className="text-xs font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap">
            {account.name}
          </Link>
          <span className="text-[10px] text-muted-foreground">· {TYPE_LABELS[account.type]}</span>
          {/* Noktalı ayraç */}
          <span className="flex-1 border-b border-dotted border-border mx-1 translate-y-1" />
          <span className={`text-xs font-bold tabular-nums ${account.balance < 0 ? 'text-destructive' : 'text-foreground'}`}>
            {formatCurrency(account.balance, account.currency)}
          </span>
          <button
            onClick={() => onEdit(account)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-muted-foreground hover:text-foreground w-6 text-right"
          >
            ✎
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 h-[43px] border-t border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ara Toplam</span>
        <span className="flex-1" />
        <span className={`text-xs font-bold tabular-nums ${debt ? 'text-destructive' : 'text-foreground'}`}>
          {formatCurrency(total)}
        </span>
        <span className="w-6" />
      </div>
    </div>
  )
}
