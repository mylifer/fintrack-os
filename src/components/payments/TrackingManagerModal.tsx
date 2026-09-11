'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils/currency'
import { setTracking } from '@/lib/payments/actions'
import type { PaymentTarget } from '@/lib/payments/schedule'
import type { Account } from '@/types'
import { TargetMark, Toggle } from './board/bits'

/* ── Takip edilenler ─────────────────────────────────────────────────────────
   Tüm kredi kartları ve ödenecek borçlar kendiliğinden takiptedir; burada tek
   tek takipten çıkarılır ya da varsayılanları açılır. */

interface Props {
  open: boolean
  targets: PaymentTarget[]
  accounts: Account[]
  onClose: () => void
  onSettings: (target: PaymentTarget) => void
}

export function TrackingManagerModal({ open, targets, accounts, onClose, onSettings }: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function toggle(t: PaymentTarget) {
    setBusyKey(t.key)
    try {
      await setTracking(t, !t.isActive)
    } catch (err) {
      console.error('[payments:tracking]', err)
    } finally {
      setBusyKey(null)
    }
  }

  const groups = [
    { title: 'Kredi kartları', items: targets.filter(t => t.kind === 'card') },
    { title: 'Borçlar', items: targets.filter(t => t.kind === 'debt') },
  ].filter(g => g.items.length > 0)

  return (
    <Modal open={open} onClose={onClose} title="Takip edilen ödemeler" size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-muted-foreground">
          Kredi kartların ve ödeyeceğin borçlar kendiliğinden takipte. Takipten çıkardığın kalem hiçbir görünümde
          çıkmaz; kayıtları silinmez. Arşivlenmiş kartlar ve sana olan alacaklar takip edilmez.
        </p>

        {groups.map(g => (
          <div key={g.title}>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{g.title}</div>
            <ul className="rounded-xl border border-border/60 divide-y divide-border/40">
              {g.items.map(t => {
                const from = accounts.find(a => a.id === t.defaultFromAccountId)?.name ?? 'hesap seçilmedi'
                const amount = t.defaultAmount !== null
                  ? formatCurrency(t.defaultAmount, t.currency)
                  : t.kind === 'card' ? 'ekstre tahmini' : 'tutar yok'
                return (
                  <li key={t.key} className="flex items-center gap-3 px-3 py-2.5">
                    <TargetMark target={t} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${t.isActive ? '' : 'text-muted-foreground line-through'}`}>{t.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        Ayın {t.dayOfMonth}. günü · {amount} · {from}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => onSettings(t)}>Ayarlar</Button>
                    <Toggle
                      checked={t.isActive}
                      onChange={() => { void toggle(t) }}
                      label={`${t.name} takipte`}
                      disabled={busyKey === t.key}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
