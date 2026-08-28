'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils/currency'
import { PendingBadge, RowActions, SortTh } from '@/components/ui/BoardBits'
import { buildTree, shortDate, type CategoryNode, type CategoryRow } from '../shared'
import { CategoryLabel, amountTone, type CategoryViewProps } from './bits'

/**
 * Görünüm — Tablo
 * En yoğun alternatif: gerçek bir tablo, yapışkan başlık, tek satır = 40px.
 * Kolonlar sabit hizada (tabular-nums + sağa yaslı sayılar), başlıklar
 * tıklanınca sıralama değişir.
 *
 * Satırlar KIRILIM AĞACI olarak dizilir: kökler seçili ölçüte göre sıralanır,
 * her kökün altında alt kategorileri aynı ölçütle sıralanmış olarak açılır.
 * Böylece "Yeme İçme ₺12.480" satırının altında neyin ne kadar olduğu görünür.
 * Bir üst kategorinin doğrudan kendi işlemleri varsa kırılımın sonunda
 * "Doğrudan …" satırı olarak çıkar — alt kategoriler + doğrudan = üstün toplamı.
 *
 * Arama yapılırken ağaç DÜZLEŞİR (eşleşen satırlar, "üst › alt" yoluyla):
 * eşleşmeyen bir üstü sırf bağlam için göstermek listeyi yanıltırdı.
 *
 * Kolonlar: Kategori · İşlem · Toplam · Ortalama · Pay · Son İşlem
 */
export function TableView({ rows, query, sort, onSort, onEdit, onArchive }: CategoryViewProps) {
  const flat = query.trim() !== ''
  const tree = useMemo(() => buildTree(rows, sort), [rows, sort])

  // Varsayılan: tüm kırılımlar AÇIK (kapalı olanlar burada tutulur).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const hasGroups = tree.some(n => n.children.length > 0)
  const allCollapsed = hasGroups && tree.every(n => n.children.length === 0 || collapsed.has(n.row.category.id))

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allCollapsed) { setCollapsed(new Set()); return }
    const ids: string[] = []
    const walk = (nodes: CategoryNode[]) => {
      for (const n of nodes) {
        if (n.children.length > 0) { ids.push(n.row.category.id); walk(n.children) }
      }
    }
    walk(tree)
    setCollapsed(new Set(ids))
  }

  /** Ağacı görünür satır dizisine çevirir; kapalı düğümlerin altı atlanır. */
  function renderNodes(nodes: CategoryNode[], depth: number): React.ReactNode[] {
    const out: React.ReactNode[] = []
    for (const node of nodes) {
      const id = node.row.category.id
      const open = node.children.length > 0 && !collapsed.has(id)
      out.push(
        <Row
          key={id}
          row={node.row}
          depth={depth}
          query={query}
          flat={flat}
          expandable={node.children.length > 0}
          open={open}
          onToggle={() => toggle(id)}
          onEdit={onEdit}
          onArchive={onArchive}
        />,
      )
      if (open) {
        out.push(...renderNodes(node.children, depth + 1))
        // Üstün kendi işlemleri: kırılımın kapanış satırı, toplamı tamamlar.
        if (node.row.ownMagnitude > 0) {
          out.push(<OwnRow key={`${id}-own`} row={node.row} depth={depth + 1} />)
        }
      }
    }
    return out
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="text-left pl-2 py-2 font-semibold">
                <div className="flex items-center gap-1">
                  {!flat && hasGroups ? (
                    <button
                      type="button"
                      onClick={toggleAll}
                      title={allCollapsed ? 'Tüm kırılımları aç' : 'Tüm kırılımları kapat'}
                      aria-label={allCollapsed ? 'Tüm kırılımları aç' : 'Tüm kırılımları kapat'}
                      className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <Chevron open={!allCollapsed} />
                    </button>
                  ) : (
                    <span className="size-5" />
                  )}
                  <button
                    type="button"
                    onClick={() => onSort('name')}
                    aria-pressed={sort === 'name'}
                    className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors ${
                      sort === 'name' ? 'text-foreground' : 'hover:text-foreground'
                    }`}
                  >
                    Kategori
                    <span className={`text-[8px] leading-none ${sort === 'name' ? 'opacity-100' : 'opacity-0'}`}>▼</span>
                  </button>
                </div>
              </th>
              <SortTh id="count"  sort={sort} onSort={onSort} className="text-right w-20">İşlem</SortTh>
              <SortTh id="total"  sort={sort} onSort={onSort} className="text-right w-36">Toplam</SortTh>
              <th className="text-right w-28 py-2 font-semibold">Ortalama</th>
              <th className="text-right w-16 py-2 font-semibold" title={flat ? 'Kapsam toplamı içindeki payı' : 'Kök: kapsam toplamı içindeki payı · Alt: üst kategorisi içindeki payı'}>
                Pay
              </th>
              <SortTh id="recent" sort={sort} onSort={onSort} className="text-right w-24">Son İşlem</SortTh>
              <th className="w-20 py-2" />
            </tr>
          </thead>
          <tbody>
            {flat
              ? rows.map(row => (
                  <Row
                    key={row.category.id}
                    row={row}
                    depth={0}
                    query={query}
                    flat
                    expandable={false}
                    open={false}
                    onToggle={() => {}}
                    onEdit={onEdit}
                    onArchive={onArchive}
                  />
                ))
              : renderNodes(tree, 0)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({
  row, depth, query, flat, expandable, open, onToggle, onEdit, onArchive,
}: {
  row: CategoryRow
  depth: number
  query: string
  flat: boolean
  expandable: boolean
  open: boolean
  onToggle: () => void
} & Pick<CategoryViewProps, 'onEdit' | 'onArchive'>) {
  const { category, flowCount, pendingCount, net, magnitude, share, shareOfParent } = row
  const avg = flowCount > 0 ? magnitude / flowCount : 0
  // Kırılımda okunması gereken oran üstün içindeki paydır; düz listede
  // (arama) böyle bir bağlam olmadığı için kapsam payı gösterilir.
  const shown = flat || depth === 0 ? share : shareOfParent

  return (
    <tr className="group border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors">
      <td className="py-2" style={{ paddingLeft: 8 + depth * 22 }}>
        <div className="flex items-center gap-1.5 min-w-0">
          {expandable ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              title={open ? 'Kırılımı kapat' : 'Kırılımı aç'}
              aria-label={`${category.name} kırılımı`}
              className="size-5 flex-shrink-0 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Chevron open={open} />
            </button>
          ) : (
            <span className="size-5 flex-shrink-0" />
          )}
          <Link
            href={`/categories/${category.id}`}
            className="flex items-center gap-2.5 min-w-0 hover:[&_span]:text-primary transition-colors"
          >
            {/* Ağaçta üst zincir zaten girintiyle görünüyor; yolu yalnız düz
                listede (arama) yazdır. */}
            <CategoryLabel row={flat ? row : { ...row, path: '' }} query={query} />
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
      <td
        className="text-right py-2 text-xs tabular-nums text-muted-foreground"
        title={flat || depth === 0 ? 'Kapsam toplamı içindeki payı' : 'Üst kategorisi içindeki payı'}
      >
        {shown > 0 ? `%${(shown * 100).toFixed(shown < 0.1 ? 1 : 0)}` : '—'}
      </td>
      <td className="text-right py-2 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
        {shortDate(row.lastDate)}
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
}

/** Üst kategorinin DOĞRUDAN kendi işlemleri — alt kategorilere dağılmayan kısım.
 *  Kırılımın toplamı üstün toplamını tutsun diye gösterilir. */
function OwnRow({ row, depth }: { row: CategoryRow; depth: number }) {
  const { category, ownMagnitude, ownCount, magnitude } = row
  const avg = ownCount > 0 ? ownMagnitude / ownCount : 0
  const share = magnitude > 0 ? ownMagnitude / magnitude : 0

  return (
    <tr className="border-b border-border/50 last:border-0 bg-muted/15">
      <td className="py-2" style={{ paddingLeft: 8 + depth * 22 }}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="size-5 flex-shrink-0" />
          <span
            className="text-[13px] text-muted-foreground italic truncate"
            title={`${category.name} kategorisine doğrudan işlenmiş, alt kategorilere dağılmamış işlemler`}
          >
            Doğrudan {category.name}
          </span>
        </div>
      </td>
      <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">{ownCount || '—'}</td>
      <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
        {ownMagnitude > 0 ? formatCurrency(ownMagnitude) : '—'}
      </td>
      <td className="text-right py-2 text-sm tabular-nums text-muted-foreground">
        {avg > 0 ? formatCurrency(avg) : '—'}
      </td>
      <td className="text-right py-2 text-xs tabular-nums text-muted-foreground" title="Üst kategorisi içindeki payı">
        {share > 0 ? `%${(share * 100).toFixed(share < 0.1 ? 1 : 0)}` : '—'}
      </td>
      <td colSpan={2} />
    </tr>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}
