'use client'

import Link from 'next/link'
import { formatCurrency } from '@/lib/utils/currency'
import { PendingBadge, RowActions, SortTh } from '@/components/ui/BoardBits'
import { shortDate } from '../shared'
import { CategoryLabel, amountTone, type CategoryViewProps } from './bits'

/**
 * Görünüm — Tablo
 * En yoğun alternatif: gerçek bir tablo, yapışkan başlık, tek satır = 40px.
 * Kolonlar sabit hizada (tabular-nums + sağa yaslı sayılar), başlıklar
 * tıklanınca sıralama değişir. Kategorileri yukarıdan aşağı KIYASLAMAK için.
 *
 * Kolonlar: Kategori · İşlem · Toplam · Ortalama · Pay · Son İşlem
 * Tutarlar alt ağacı kapsar; "Pay" paydası yalnız kök kategorilerdir, bu yüzden
 * alt kategori satırlarının payı kendi kökünün içinden gelir.
 */
export function TableView({ rows, query, sort, onSort, onEdit, onArchive }: CategoryViewProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <SortTh id="name"   sort={sort} onSort={onSort} className="text-left pl-4">Kategori</SortTh>
              <SortTh id="count"  sort={sort} onSort={onSort} className="text-right w-20">İşlem</SortTh>
              <SortTh id="total"  sort={sort} onSort={onSort} className="text-right w-36">Toplam</SortTh>
              <th className="text-right w-28 py-2 font-semibold">Ortalama</th>
              <th className="text-right w-16 py-2 font-semibold">Pay</th>
              <SortTh id="recent" sort={sort} onSort={onSort} className="text-right w-24">Son İşlem</SortTh>
              <th className="w-20 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const { category, flowCount, pendingCount, net, magnitude, share, lastDate } = row
              const avg = flowCount > 0 ? magnitude / flowCount : 0
              return (
                <tr
                  key={category.id}
                  className="group border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors"
                >
                  <td className="pl-4 py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Link
                        href={`/categories/${category.id}`}
                        className="flex items-center gap-2.5 min-w-0 hover:[&_span]:text-primary transition-colors"
                      >
                        <CategoryLabel row={row} query={query} />
                      </Link>
                      <PendingBadge count={pendingCount} />
                    </div>
                  </td>
                  <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
                    {flowCount || '—'}
                  </td>
                  <td className={`text-right py-2 text-sm font-medium tabular-nums ${amountTone(net)}`}>
                    {magnitude > 0 ? formatCurrency(magnitude) : '—'}
                  </td>
                  <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
                    {avg > 0 ? formatCurrency(avg) : '—'}
                  </td>
                  <td className="text-right py-2 text-xs tabular-nums text-muted-foreground">
                    {share > 0 ? `%${(share * 100).toFixed(share < 0.1 ? 1 : 0)}` : '—'}
                  </td>
                  <td className="text-right py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {shortDate(lastDate)}
                  </td>
                  <td className="py-2 pr-2">
                    <RowActions
                      name={category.name}
                      onEdit={() => onEdit(category)}
                      // Sistem kategorileri arşivlenemez (store da reddeder).
                      onArchive={category.isSystem ? undefined : () => onArchive(category)}
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
