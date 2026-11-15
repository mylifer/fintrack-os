'use client'

import { useMemo, useState } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import { tr } from 'date-fns/locale'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { useTransactionStore, useUIStore, useCategoryStore, useAccountStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { Transaction } from '@/types'

/* ── Son Eklenenler ─────────────────────────────────────────────────────────
   İşlemleri İŞLEM TARİHİNE göre değil, uygulamaya EKLENDİĞİ ana (createdAt)
   göre listeler: "az önce ne girdim?" sorusunun cevabı. Eklenme gününe göre
   gruplanır, her satırda eklenme saati + işlem tarihi birlikte görünür.
   Sistem satırları (mutabakat hayaletleri) kullanıcı eklemesi olmadığı için
   gösterilmez. */

type Window = '24h' | '7d' | '30d' | 'all'

const WINDOWS: { value: Window; label: string; ms: number | null }[] = [
  { value: '24h', label: 'Son 24 saat', ms: 24 * 3600_000 },
  { value: '7d',  label: 'Son 7 gün',   ms: 7 * 24 * 3600_000 },
  { value: '30d', label: 'Son 30 gün',  ms: 30 * 24 * 3600_000 },
  { value: 'all', label: 'Tümü',        ms: null },
]

const PAGE = 100

const TYPE_STYLE: Record<Transaction['type'], { sign: string; cls: string; label: string }> = {
  expense:  { sign: '−', cls: 'text-destructive',      label: 'Gider' },
  income:   { sign: '+', cls: 'text-green-600',        label: 'Gelir' },
  transfer: { sign: '',  cls: 'text-muted-foreground', label: 'Transfer' },
}

function parseStamp(iso: string | undefined): Date | null {
  if (!iso) return null
  const d = parseISO(iso)
  return isValid(d) ? d : null
}

function dayLabel(d: Date, now: Date): string {
  const key = format(d, 'yyyy-MM-dd')
  if (key === format(now, 'yyyy-MM-dd')) return 'Bugün'
  const y = new Date(now); y.setDate(y.getDate() - 1)
  if (key === format(y, 'yyyy-MM-dd')) return 'Dün'
  return format(d, 'd MMMM yyyy, EEEE', { locale: tr })
}

export default function RecentTransactionsPage() {
  const transactions = useTransactionStore(s => s.transactions)
  const ready        = useTransactionStore(s => s.ready)
  const categories   = useCategoryStore(s => s.categories)
  const accounts     = useAccountStore(s => s.accounts)
  const openModal    = useUIStore(s => s.openModal)

  const [win, setWin]     = useState<Window>('7d')
  const [limit, setLimit] = useState(PAGE)
  // "Şimdi" sayfa açılışında sabitlenir; pencere filtresi render başına kaymasın.
  const [now] = useState(() => new Date())

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  const sorted = useMemo(() => {
    const ms = WINDOWS.find(w => w.value === win)?.ms ?? null
    const since = ms === null ? null : now.getTime() - ms
    return transactions
      .filter(t => !t.systemKind && !t.deleted_at)
      .map(t => ({ tx: t, at: parseStamp(t.createdAt) }))
      .filter((r): r is { tx: Transaction; at: Date } => r.at !== null)
      .filter(r => since === null || r.at.getTime() >= since)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
  }, [transactions, win, now])

  const groups = useMemo(() => {
    const out: { label: string; rows: typeof sorted }[] = []
    for (const r of sorted.slice(0, limit)) {
      const label = dayLabel(r.at, now)
      const last = out[out.length - 1]
      if (last && last.label === label) last.rows.push(r)
      else out.push({ label, rows: [r] })
    }
    return out
  }, [sorted, limit, now])

  return (
    <div className="flex flex-col h-full">
      <Header title="Son Eklenenler" action={{ label: 'Ekle', onClick: () => openModal('add-transaction') }} />
      <div className="flex-1 overflow-hidden p-4 lg:p-6">
        <div className="h-full rounded-2xl border border-border bg-card overflow-hidden flex flex-col">

          {/* Zaman penceresi */}
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
            {WINDOWS.map(w => (
              <button
                key={w.value}
                type="button"
                onClick={() => { setWin(w.value); setLimit(PAGE) }}
                aria-pressed={win === w.value}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  win === w.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {w.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">{sorted.length} işlem</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {groups.length === 0 ? (
              <EmptyState
                icon="🕒"
                title={!ready ? 'Yükleniyor…' : 'Bu aralıkta eklenen işlem yok'}
                description="Eklediğiniz işlemler burada eklenme zamanına göre listelenir."
              />
            ) : (
              <>
                {groups.map(g => (
                  <section key={g.label}>
                    <div className="sticky top-0 z-10 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-card/95 backdrop-blur border-b border-border/60">
                      {g.label} <span className="opacity-60">· {g.rows.length}</span>
                    </div>
                    <div className="flex flex-col divide-y divide-border/60">
                      {g.rows.map(({ tx, at }) => {
                        const cat = tx.categoryId ? catById.get(tx.categoryId) : undefined
                        const acc = accById.get(tx.accountId)
                        const toAcc = tx.toAccountId ? accById.get(tx.toAccountId) : undefined
                        const style = TYPE_STYLE[tx.type] ?? TYPE_STYLE.expense
                        const updated = parseStamp(tx.updatedAt)
                        const edited = updated !== null && updated.getTime() - at.getTime() > 1000
                        return (
                          <button
                            key={tx.id}
                            type="button"
                            onClick={() => openModal('edit-transaction', { id: tx.id })}
                            className="w-full text-left flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors"
                          >
                            <div className="w-16 flex-shrink-0 text-xs tabular-nums text-foreground" title={format(at, 'd MMMM yyyy HH:mm:ss', { locale: tr })}>
                              <div className="font-semibold">{format(at, 'HH:mm:ss')}</div>
                            </div>
                            {cat ? (
                              <CategoryIcon icon={cat.icon} color={cat.color} size={16} />
                            ) : (
                              <span className="size-[26px] flex-shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
                                {tx.type === 'transfer' ? '⇄' : '•'}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-foreground truncate">
                                {tx.description || cat?.name || style.label}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                İşlem tarihi: {formatDate(tx.date)}
                                {acc && <> · {acc.name}{toAcc && <> → {toAcc.name}</>}</>}
                                {cat && <> · {cat.name}</>}
                                {edited && updated && (
                                  <span title={`Son düzenleme: ${format(updated, 'd MMMM yyyy HH:mm:ss', { locale: tr })}`}>
                                    {' '}· düzenlendi {format(updated, 'd MMM HH:mm', { locale: tr })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className={`text-sm font-semibold tabular-nums flex-shrink-0 ${style.cls}`}>
                              {style.sign}{formatCurrency(Math.abs(tx.amount), tx.currency)}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
                {sorted.length > limit && (
                  <div className="p-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setLimit(l => l + PAGE)}
                      className="text-xs font-medium px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
                    >
                      Daha fazla göster ({sorted.length - limit} kaldı)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
