'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { assetMeta, fmtQty } from './shared'
import type { Account, InvestmentTransaction, TefasFundPrice } from '@/types'

/* ── İşlem geçmişi ───────────────────────────────────────────────────────────
 * Eski serbest akışlı satır yerine KOLONLU tablo: tarih, varlık, tür, miktar,
 * birim fiyat, tutar ve bağlı hesap her satırda aynı x konumunda. Dikey
 * karşılaştırma (aynı varlığın alım fiyatları) ancak böyle yapılabiliyor.
 * ------------------------------------------------------------------------- */

export function TransactionTable({
  transactions, fundPrices, accounts, onEdit, onDelete, showAsset = true,
}: {
  transactions: InvestmentTransaction[]
  fundPrices:   Record<string, TefasFundPrice>
  accounts:     Account[]
  onEdit:       (tx: InvestmentTransaction) => void
  onDelete:     (id: string) => void
  showAsset?:   boolean
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (!transactions.length) {
    return (
      <div className="px-5 py-10 text-center text-sm text-muted-foreground">Henüz işlem yok.</div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 text-[10px] text-muted-foreground">
            <th className="pl-4 pr-3 py-2 text-left  font-semibold uppercase tracking-wide whitespace-nowrap">Tarih</th>
            {showAsset && <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide whitespace-nowrap">Varlık</th>}
            <th className="px-3 py-2 text-left  font-semibold uppercase tracking-wide whitespace-nowrap">Tür</th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Miktar</th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Birim Fiyat</th>
            <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide whitespace-nowrap">Tutar</th>
            <th className="px-3 py-2 text-left  font-semibold uppercase tracking-wide whitespace-nowrap">Hesap</th>
            <th className="px-3 py-2 text-left  font-semibold uppercase tracking-wide whitespace-nowrap">Not</th>
            <th className="pl-3 pr-4 py-2 w-[74px]" />
          </tr>
        </thead>
        <tbody>
          {transactions.map(tx => {
            const meta  = assetMeta(tx.asset, fundPrices)
            const isBuy = tx.type === 'buy'
            const total = tx.quantity * tx.pricePerUnit
            const acc   = isBuy
              ? (tx.sourceAccountId ? accounts.find(a => a.id === tx.sourceAccountId) : null)
              : (tx.targetAccountId ? accounts.find(a => a.id === tx.targetAccountId) : null)
            const confirming = confirmId === tx.id

            return (
              <tr key={tx.id} className="group border-b border-border/40 h-10 hover:bg-accent transition-colors">
                <td className="pl-4 pr-3 tabular-nums text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>

                {showAsset && (
                  <td className="px-3 whitespace-nowrap">
                    <span className="font-medium text-foreground" title={meta.subLabel}>{meta.label}</span>
                  </td>
                )}

                <td className="px-3 whitespace-nowrap">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    isBuy ? 'bg-green-600/10 text-green-600' : 'bg-destructive/10 text-destructive'
                  }`}>
                    {isBuy ? 'AL' : 'SAT'}
                  </span>
                </td>

                <td className="px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmtQty(tx.quantity, meta.unit)}</td>
                <td className="px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">{formatCurrency(tx.pricePerUnit)}</td>
                <td className={`px-3 text-right tabular-nums font-medium whitespace-nowrap ${isBuy ? 'text-destructive' : 'text-green-600'}`}>
                  {(isBuy ? '−' : '+') + formatCurrency(total)}
                </td>

                <td className="px-3 whitespace-nowrap max-w-[150px] truncate">
                  {acc ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-1.5 rounded-full flex-shrink-0" style={{ background: acc.color ?? '#00E5FF' }} />
                      {acc.name}
                    </span>
                  ) : <span className="text-muted-foreground/60">—</span>}
                </td>

                <td className="px-3 text-muted-foreground max-w-[180px] truncate" title={tx.note}>
                  {tx.note || <span className="text-muted-foreground/60">—</span>}
                </td>

                <td className="pl-3 pr-4">
                  <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {confirming ? (
                      <>
                        <button
                          onClick={() => { onDelete(tx.id); setConfirmId(null) }}
                          className="px-2 h-6 rounded-lg bg-destructive text-white text-[10px] font-semibold"
                        >Sil</button>
                        <button
                          onClick={() => setConfirmId(null)}
                          aria-label="Vazgeç"
                          className="size-6 rounded-lg border border-border text-muted-foreground text-[10px]"
                        >✕</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onEdit(tx)}
                          title="Düzenle"
                          aria-label={`${meta.label} işlemini düzenle`}
                          className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setConfirmId(tx.id)}
                          title="Sil"
                          aria-label={`${meta.label} işlemini sil`}
                          className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                        >
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
