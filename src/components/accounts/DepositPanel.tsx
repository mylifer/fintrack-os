'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { depositTerms, projectDeposit } from '@/lib/utils/deposit'
import { processDepositInterest } from '@/lib/deposit-actions'
import { Badge } from '@/components/ui/Badge'
import type { Account } from '@/types'

/** Vadeli hesabın vade özeti (lib/utils/deposit) ve vade sonunda faizi işleme.
 *  Koşul girilmemiş vadeli hesapta panel görünmez. */
export function DepositPanel({ account }: { account: Account }) {
  const [busy, setBusy]   = useState(false)
  // İşlenen faiz ve TARİHİ: yenilemeden sonra terms yeni vadeyi gösterir
  const [done, setDone]   = useState<{ net: number; date: string } | null>(null)
  const terms = depositTerms(account)
  if (!terms) return null

  const p     = projectDeposit(account.balance, terms, today())
  const money = (n: number) => formatCurrency(n, account.currency)
  const fmt   = (iso: string) => formatDate(iso, 'd MMM yyyy')

  async function process(renew: boolean) {
    if (busy) return
    setBusy(true)
    try {
      const date = terms!.end
      setDone({ net: await processDepositInterest(account, { renew }), date })
    } catch (err) {
      console.error('[deposit:process]', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 lg:px-8 py-4 border-b border-border bg-card flex-shrink-0">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vadeli Mevduat</span>
          {p.matured
            ? <Badge variant="amber">Vade doldu</Badge>
            : <Badge variant="secondary">{p.daysLeft} gün kaldı</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">
          %{terms.rate.toLocaleString('tr-TR')} · {fmt(terms.start)} – {fmt(terms.end)} ({p.days} gün) · stopaj %{terms.taxPct.toLocaleString('tr-TR')}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cell label="Anapara" value={money(account.balance)} />
        <Cell label="Net faiz (vade sonu)" value={money(p.net)} note={`Brüt ${money(p.gross)} · stopaj ${money(p.tax)}`} tone="text-green-600" />
        <Cell label="Vade sonu tutarı" value={money(p.maturityValue)} />
        <Cell label="Bugüne kadar işleyen" value={money(p.accruedNet)} note="Net, bilgi amaçlı" />
      </div>

      {p.matured && done === null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-foreground flex-1 min-w-48">
            Vade {fmt(terms.end)} tarihinde doldu. {money(p.net)} net faiz hesaba işlensin mi?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => process(true)}
            className="px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Faizi işle ve {p.days} gün yenile
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => process(false)}
            className="px-3 h-8 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          >
            Faizi işle, vadeyi bitir
          </button>
        </div>
      )}
      {done !== null && (
        <p className="mt-3 text-xs text-green-600">
          {money(done.net)} net faiz {fmt(done.date)} tarihiyle hesaba işlendi.
        </p>
      )}
    </div>
  )
}

function Cell({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-medium tabular-nums mt-0.5 ${tone ?? ''}`}>{value}</div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  )
}
