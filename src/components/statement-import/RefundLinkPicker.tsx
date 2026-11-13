'use client'

import { useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { foldText } from '@/lib/auto-category'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import type { PlanRow, RefundCandidate } from '@/lib/statement-import/classify'
import { selectedOption, type RowChoices, type RowEdit } from '@/lib/statement-import/commit'

/* ── İade satırı: hangi alımın iadesi? ───────────────────────────────────────
   "İade, alıma bağla" seçilince satırın altında aday alımlar kart olarak
   durur (aynı işyeri/alıcı; tutarı tutan önce). "Diğer…" bu karttaki öteki
   alımları aranabilir bir listede açar. Seçilen alım iadeye bağlanır;
   açıklama, alıcı, kategori ve etiketler o alımdan gelir. */

interface Props {
  row: PlanRow
  /** Seçili bağlantı: düzenleme, yoksa kararın taslağındaki (tutarı tutan alım) */
  selectedId: string | undefined
  onPick: (patch: RowEdit) => void
  /** Pencerede: kartlar alt alta */
  stacked?: boolean
}

/** Satırda seçili bağlantı: düzenleme (null = kaldırıldı), yoksa "İade, alıma bağla"
 *  kararının taslağındaki alım (tutarı tutan) */
export function refundLinkSelection(row: PlanRow, choices: Readonly<RowChoices>, edit: RowEdit | undefined): string | undefined {
  if (edit?.refundOfId !== undefined) return edit.refundOfId ?? undefined
  const o = row.options[selectedOption(row, choices) ?? -1]
  const a = o?.key === 'link' ? o.actions.find(x => x.type === 'create') : undefined
  return a?.type === 'create' ? a.draft.refundOfId : undefined
}

const shortDate = (iso: string) => formatDate(iso, 'd MMM')

function Card({ c, selected, onPick, wide }: { c: RefundCandidate; selected: boolean; onPick: () => void; wide?: boolean }) {
  return (
    <button
      type="button" role="radio" aria-checked={selected} onClick={onPick}
      className={cn('flex-none rounded-xl border px-3 py-2 text-left transition-colors',
        wide ? 'w-full flex items-center gap-3' : 'w-48',
        selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted/50')}
    >
      <span className={cn('block min-w-0', wide && 'flex-1')}>
        <span className="block text-sm font-medium truncate">{c.title}</span>
        <span className="block text-xs text-muted-foreground truncate">{shortDate(c.date)}{c.who ? ` · ${c.who}` : ''}</span>
      </span>
      <span className={cn('block', wide ? 'text-right flex-none' : 'mt-1')}>
        <span className="block text-sm font-semibold tabular-nums">{formatCurrency(c.amount)}</span>
        {c.exact
          ? <span className="inline-block rounded-full bg-green-600/10 px-1.5 text-[11px] font-semibold text-green-700 dark:text-green-400">Tutar tutuyor</span>
          : <span className="block text-[11px] text-muted-foreground">kısmi iade</span>}
      </span>
    </button>
  )
}

export function RefundLinkPicker({ row, selectedId, onPick, stacked }: Props) {
  const link = row.refundLink
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const others = useMemo(() => {
    if (!link) return []
    const q = foldText(query)
    if (!q) return link.more
    return link.more.filter(c => foldText(`${c.title} ${c.who ?? ''} ${c.amount.toFixed(2).replace('.', ',')} ${shortDate(c.date)}`).includes(q))
  }, [link, query])

  if (!link) return null
  // Listeden seçilmiş "diğer" alım da üstte görünsün
  const pickedOther = link.more.find(c => c.txId === selectedId)
  const top = pickedOther && !open ? [...link.candidates, pickedOther] : link.candidates

  return (
    <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
      <div role="radiogroup" aria-label="Bağlanacak alım" className={cn(stacked ? 'flex flex-col gap-1.5' : 'flex gap-2 overflow-x-auto pb-1')}>
        {top.map(c => <Card key={c.txId} c={c} selected={selectedId === c.txId} onPick={() => onPick(c.patch)} wide={stacked} />)}
        {link.more.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
            className={cn('flex-none rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-primary hover:bg-muted/50',
              stacked ? 'w-full text-left' : 'w-28')}>
            {open ? 'Kapat' : top.length ? 'Diğer…' : 'Alım seç…'}
          </button>
        )}
      </div>
      {!selectedId && <span className="text-xs text-orange-600">Hangi alımın iadesi olduğunu seçin.</span>}
      {open && (
        <div className="rounded-xl border border-border bg-card p-2 flex flex-col gap-1.5">
          <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <IconSearch className="size-4 text-muted-foreground" aria-hidden />
            <input
              value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder="Bu karttaki alımlarda ara: ad, tutar, tarih"
              className="flex-1 min-w-0 bg-transparent text-sm outline-none"
              aria-label="Alım ara"
            />
          </label>
          <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
            {others.map(c => (
              <Card key={c.txId} c={c} selected={selectedId === c.txId} wide onPick={() => { onPick(c.patch); setOpen(false); setQuery('') }} />
            ))}
            {!others.length && <span className="px-1 py-2 text-xs text-muted-foreground">Sonuç yok. Yalnız bu karttaki, iadeden küçük olmayan son 12 ayın alımları listelenir.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
