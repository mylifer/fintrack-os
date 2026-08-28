'use client'

import Link from 'next/link'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { formatCurrency, formatSigned } from '@/lib/utils/currency'
import { shortDate } from '../shared'
import { Highlight, netTone, PendingBadge, RowActions, SortTh } from '@/components/ui/BoardBits'
import type { PersonViewProps } from './bits'

/**
 * Görünüm — Tablo
 * En yoğun alternatif: gerçek bir tablo, yapışkan başlık, tek satır = 40px.
 * Kolonlar sabit hizada (tabular-nums + sağa yaslı sayılar), başlıklar
 * tıklanınca sıralama değişir. Çok kişiyi yukarıdan aşağı KIYASLAMAK için.
 *
 * Para kolonları varyanta göre değişir; alıcıda tek yön (gider) vardır, aile
 * üyesinde iki yön de anlamlıdır:
 *   alıcı  → Toplam Gider · Ortalama · Pay
 *   üye    → Gelir · Gider · Net
 */
export function TableView({ rows, config, query, sort, onSort, onEdit, onArchive }: PersonViewProps) {
  const isMember = config.role === 'family_member'

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Aile üyesi tablosu 7 kolona çıkıyor: dar ekranda kırpmak yerine kaydır. */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <SortTh id="name"  sort={sort} onSort={onSort} className="text-left pl-4">{config.labels.nameColumn}</SortTh>
            <SortTh id="count" sort={sort} onSort={onSort} className="text-right w-20">İşlem</SortTh>
            {isMember ? (
              <>
                <SortTh id="income" sort={sort} onSort={onSort} className="text-right w-32">Gelir</SortTh>
                <SortTh id="spend"  sort={sort} onSort={onSort} className="text-right w-32">Gider</SortTh>
                <th className="text-right w-32 py-2 font-semibold">Net</th>
              </>
            ) : (
              <>
                <SortTh id="spend" sort={sort} onSort={onSort} className="text-right w-36">Toplam Gider</SortTh>
                <th className="text-right w-28 py-2 font-semibold">Ortalama</th>
                <th className="text-right w-16 py-2 font-semibold">Pay</th>
              </>
            )}
            <SortTh id="recent" sort={sort} onSort={onSort} className="text-right w-24">Son İşlem</SortTh>
            <th className="w-20 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const { person, flowCount, pendingCount, income, expense, net, share, lastDate } = row
            const avg = flowCount > 0 ? expense / flowCount : 0
            return (
              <tr
                key={person.id}
                className="group border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors"
              >
                <td className="pl-4 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PersonAvatar person={person} size="sm" />
                    <Link
                      href={`${config.basePath}/${person.id}`}
                      className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors"
                    >
                      <Highlight text={person.name} query={query} />
                    </Link>
                    <PendingBadge count={pendingCount} />
                  </div>
                </td>
                <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
                  {flowCount || '—'}
                </td>

                {isMember ? (
                  <>
                    <td className="text-right py-2 text-sm tabular-nums text-green-600">
                      {income > 0 ? formatCurrency(income) : '—'}
                    </td>
                    <td className="text-right py-2 text-sm tabular-nums text-destructive">
                      {expense > 0 ? formatCurrency(expense) : '—'}
                    </td>
                    <td className={`text-right py-2 text-sm font-medium tabular-nums ${netTone(net)}`}>
                      {income > 0 || expense > 0 ? formatSigned(net) : '—'}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="text-right py-2 text-sm font-medium tabular-nums text-foreground">
                      {expense > 0 ? formatCurrency(expense) : '—'}
                    </td>
                    <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
                      {avg > 0 ? formatCurrency(avg) : '—'}
                    </td>
                    <td className="text-right py-2 text-xs tabular-nums text-muted-foreground">
                      {share > 0 ? `%${(share * 100).toFixed(share < 0.1 ? 1 : 0)}` : '—'}
                    </td>
                  </>
                )}

                <td className="text-right py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                  {shortDate(lastDate)}
                </td>
                <td className="py-2 pr-2">
                  <RowActions
                    name={person.name}
                    onEdit={() => onEdit(person)}
                    onArchive={() => onArchive(person)}
                    className="justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

