'use client'

import { useMemo, useState } from 'react'
import { useCategoryStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate, today } from '@/lib/utils/date'
import { isFlowTx } from '@/lib/utils/calculations'
import { expandByCategory } from '@/lib/utils/categorySplits'
import { baseAmount } from '@/lib/utils/fx'
import { TxDetailSheet } from '@/components/transactions/views/TxDetailSheet'
import type { Account, Transaction } from '@/types'

/* Hesap detayının sağ sütunu: seçili dönemde para nereye gitti, harcama
   zamana nasıl yayıldı, hangi taksitler sürüyor. Tutarlar ₺-normalize
   (baseAmount) — dönem akışı (calcPeriodFlow) ile aynı taban; akışa girmeyen
   satırlar (mutabakat, anapara hareketi, onay bekleyen) isFlowTx ile dışarıda. */

const OTHER_COLOR = '#94a3b8'
const ACCENT = 'var(--primary)'

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export function AccountInsights({
  account, accountTxs, from, to,
}: {
  account: Account
  /** Hesaba dokunan TÜM kayıtlar (taksit planları dönem dışına taşar) */
  accountTxs: Transaction[]
  from: string
  to: string
}) {
  const categories = useCategoryStore(s => s.categories)
  const [openTx, setOpenTx] = useState<Transaction | null>(null)
  const todayStr = today()

  const spend = useMemo(
    () => accountTxs.filter(t =>
      t.type === 'expense' && t.accountId === account.id && isFlowTx(t)
      && (!from || t.date.slice(0, 10) >= from) && (!to || t.date.slice(0, 10) <= to)),
    [accountTxs, account.id, from, to],
  )
  const total = spend.reduce((s, t) => s + baseAmount(t), 0)

  const cats = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]))
    const m = new Map<string, number>()
    for (const t of expandByCategory(spend)) m.set(t.categoryId ?? '', (m.get(t.categoryId ?? '') ?? 0) + baseAmount(t))
    const list = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    const top = list.slice(0, 4).map(([id, v]) => ({ id, v, name: byId.get(id)?.name ?? 'Kategorisiz', color: byId.get(id)?.color ?? OTHER_COLOR }))
    const rest = list.slice(4).reduce((s, [, v]) => s + v, 0)
    return rest > 0 ? [...top, { id: '_other', v: rest, name: 'Diğer', color: OTHER_COLOR }] : top
  }, [spend, categories])
  const catSum = cats.reduce((s, c) => s + c.v, 0)

  // ≤ 62 gün: haftalık kova; daha uzun dönem: aylık. Tüm Zamanlar (from boş)
  // için ilk harcamadan başlanır.
  const buckets = useMemo(() => {
    const start = from || spend.reduce((m, t) => (t.date < m ? t.date.slice(0, 10) : m), todayStr)
    const end = to && to < todayStr ? to : todayStr
    if (start > end) return { weekly: true, list: [] as { label: string; title: string; v: number }[] }
    const days = Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86_400_000) + 1
    const weekly = days <= 62
    const list: { label: string; title: string; v: number }[] = []
    if (weekly) {
      for (let s = start, i = 1; s <= end; s = addDays(s, 7), i++) {
        const e = addDays(s, 6) < end ? addDays(s, 6) : end
        const v = spend.filter(t => t.date.slice(0, 10) >= s && t.date.slice(0, 10) <= e).reduce((a, t) => a + baseAmount(t), 0)
        list.push({ label: `${i}. hf`, title: `${formatDate(s, 'd MMM')} – ${formatDate(e, 'd MMM')}`, v })
      }
    } else {
      const m = new Map<string, number>()
      for (const t of spend) m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + baseAmount(t))
      for (const [k, v] of [...m.entries()].sort().slice(-12)) list.push({ label: formatDate(k + '-01', 'MMM'), title: formatDate(k + '-01', 'MMMM yyyy'), v })
    }
    return { weekly, list }
  }, [spend, from, to, todayStr])
  const maxBucket = Math.max(1, ...buckets.list.map(b => b.v))

  const plans = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of accountTxs) {
      if (t.type !== 'expense' || t.accountId !== account.id || !t.installGroupId) continue
      if (!m.has(t.installGroupId)) m.set(t.installGroupId, [])
      m.get(t.installGroupId)!.push(t)
    }
    return [...m.values()].map(rows => {
      rows.sort((a, b) => a.date.localeCompare(b.date))
      const future = rows.filter(r => r.date.slice(0, 10) > todayStr)
      return {
        first: rows[0],
        done: rows.length - future.length,
        n: rows[0].installTotal ?? rows.length,
        left: future.reduce((s, r) => s + Math.abs(r.amount), 0),
        next: future[0],
      }
    }).filter(p => p.left > 0).sort((a, b) => b.left - a.left)
  }, [accountTxs, account.id, todayStr])
  const plansLeft = plans.reduce((s, p) => s + p.left, 0)

  // Uygulamanın kart dili (shadcn Card): ince kenarlık, hafif gölge, küçük
  // büyük harfli başlık — Ayarlar ve panolardaki kartlarla aynı.
  const card = 'rounded-xl border border-border bg-card text-card-foreground p-5 shadow-sm'
  const title = 'text-xs font-medium tracking-wide uppercase text-muted-foreground'

  return (
    <aside className="flex flex-col gap-4 px-4 pb-6 lg:px-6 xl:pl-0 xl:pt-3" aria-label="Hesap içgörüleri">
      <section className={card} aria-labelledby="ins-cat">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="ins-cat" className={title}>Nereye gitti?</h2>
          <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
        </div>
        {cats.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Bu dönemde harcama yok.</p>
        ) : (
          <>
            <div className="my-3.5 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Kategorilere göre harcama dağılımı">
              {cats.map(c => <span key={c.id} style={{ width: `${(c.v / catSum) * 100}%`, background: c.color }} />)}
            </div>
            <ul className="grid gap-2 text-sm">
              {cats.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 flex-none rounded-full" style={{ background: c.color }} />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatCurrency(c.v)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {buckets.list.length > 0 && (
        <section className={card} aria-labelledby="ins-time">
          <h2 id="ins-time" className={title}>{buckets.weekly ? 'Haftalık harcama' : 'Aylık harcama'}</h2>
          <div className="mt-3 flex h-36 items-end gap-2">
            {buckets.list.map(b => (
              <div key={b.title} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${b.title}: ${formatCurrency(b.v)}`}>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {b.v >= 1000 ? `${(b.v / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}B` : Math.round(b.v)}
                </span>
                <span
                  className="w-full max-w-12 rounded-md"
                  style={{ height: `${Math.max(4, Math.round((b.v / maxBucket) * 96))}px`, background: ACCENT, opacity: b.v === maxBucket ? 1 : 0.45 }}
                  aria-label={`${b.title}: ${formatCurrency(b.v)}`}
                  role="img"
                />
                <span className="text-[11px] font-semibold text-muted-foreground">{b.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className={card} aria-labelledby="ins-inst">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="ins-inst" className={title}>Taksitler</h2>
            <span className="text-xs text-muted-foreground">{plans.length} plan · kalan {formatCurrency(plansLeft, account.currency)}</span>
          </div>
          <ul className="mt-2 flex flex-col">
            {plans.slice(0, 5).map(p => {
              const r = 16, c = 2 * Math.PI * r
              return (
                <li key={p.first.installGroupId}>
                  <button
                    type="button"
                    onClick={() => setOpenTx(p.next ?? p.first)}
                    className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-accent"
                  >
                    <svg width={42} height={42} viewBox="0 0 42 42" className="flex-none" aria-hidden="true">
                      <circle cx="21" cy="21" r={r} fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="5" />
                      <circle cx="21" cy="21" r={r} fill="none" stroke={ACCENT} strokeWidth="5" strokeLinecap="round"
                        strokeDasharray={`${(p.done / p.n) * c} ${c}`} transform="rotate(-90 21 21)" />
                      <text x="21" y="25" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">{p.done}/{p.n}</text>
                    </svg>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{p.first.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.next ? `Sıradaki ${formatDate(p.next.date.slice(0, 10), 'd MMM')}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-none flex-col items-end">
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(p.left, account.currency)}</span>
                      <span className="text-xs text-muted-foreground">kaldı</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {openTx && <TxDetailSheet tx={openTx} account={account} projected={false} onClose={() => setOpenTx(null)} />}
    </aside>
  )
}
