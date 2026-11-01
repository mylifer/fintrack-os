'use client'

import { useMemo, useState } from 'react'
import { IconChevronDown, IconSearch } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { foldText } from '@/lib/auto-category'
import { usePeopleStore } from '@/store'
import type { Category } from '@/types'
import type { PlanRow, RowKind, RowStatus } from '@/lib/statement-import/classify'
import type { RowEdit } from '@/lib/statement-import/commit'

/* ── Önizleme listesi ────────────────────────────────────────────────────────
   Hiyerarşi: Sorun → Kontrol et → Girilecek → Zaten sistemde → Kayda girmez.
   Dikkat isteyenler açık ve en üstte; sorunsuzlar kapalı başlar. Karar gereken
   satırın seçenekleri satırın içindedir — ayrıntıya girmeden karar verilebilir. */

export type StatusFilter = 'all' | 'error' | RowStatus

export const STATUS_META: Record<'error' | RowStatus, { label: string; dot: string; hint: string }> = {
  error:  { label: 'Sorun',          dot: 'bg-destructive',  hint: 'Bunlar çözülmeden kayıt yapılmaz.' },
  review: { label: 'Kontrol et',     dot: 'bg-amber-500',    hint: 'Her biri için bir seçim yapın ya da önerilenleri topluca uygulayın.' },
  new:    { label: 'Girilecek',      dot: 'bg-green-600',    hint: 'Yüksek güvenle eşleşti. Değiştirmek için satıra tıklayın.' },
  exists: { label: 'Zaten sistemde', dot: 'bg-muted-foreground', hint: 'Sistemde karşılığı var, tekrar girilmez.' },
  info:   { label: 'Kayda girmez',   dot: 'bg-sky-500',      hint: 'Bonus hareketleri; kart borcunu etkilemez.' },
}

const ORDER: (keyof typeof STATUS_META)[] = ['error', 'review', 'new', 'exists', 'info']

const SUBGROUPS: Partial<Record<RowStatus, [string, (r: PlanRow) => boolean][]>> = {
  new: [
    ['Harcamalar', r => r.kind === 'purchase'],
    ['Yeni taksitli alımlar', r => r.kind === 'installment-new'],
    ['Faiz ve ücretler', r => r.kind === 'fee'],
  ],
  exists: [
    ['Tek çekim harcamalar ve iadeler', r => r.kind === 'purchase' || r.kind === 'refund' || r.kind === 'fee'],
    ['Taksitler', r => r.kind === 'installment' || r.kind === 'lump'],
    ['Açılış bakiyesindeki taksitler', r => r.kind === 'opening'],
    ['Ödemeler', r => r.kind === 'payment'],
    ['Önceki kararla girilmeyenler', () => true],
  ],
}

const KIND_TAG: Partial<Record<RowKind, (r: PlanRow) => string>> = {
  'installment-new': r => `Yeni taksit · ${r.installment!.count} ay`,
  'installment-missing': r => `Taksit ${r.installment!.index}/${r.installment!.count}`,
  installment: r => (r.installment ? `Taksit ${r.installment.index}/${r.installment.count}` : 'Taksit'),
  opening: r => `Taksit ${r.installment!.index}/${r.installment!.count} · açılışta`,
  lump: r => `Taksit ${r.installment!.index}/${r.installment!.count} · tek kayıt`,
  'amount-diff': r => `Taksit ${r.installment!.index}/${r.installment!.count}`,
  cancel: () => 'Taksitli iptal/iade',
  refund: () => 'İade',
  fee: () => 'Faiz/ücret',
  payment: () => 'Kart ödemesi',
  orphan: () => 'Ekstrede yok',
  'net-zero': () => 'Net 0',
}

function Chip({ children, tone = 'default', title }: { children: React.ReactNode; tone?: 'default' | 'new' | 'guess' | 'tag' | 'ok' | 'bad'; title?: string }) {
  return (
    <span title={title} className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap max-w-full truncate',
      tone === 'default' && 'bg-muted text-foreground',
      tone === 'new' && 'bg-primary/10 text-primary font-medium',
      tone === 'guess' && 'border border-dashed border-muted-foreground/50 text-muted-foreground',
      tone === 'tag' && 'border border-border text-muted-foreground',
      tone === 'ok' && 'bg-green-600/10 text-green-700 dark:text-green-400',
      tone === 'bad' && 'bg-destructive/10 text-destructive font-medium',
    )}>{children}</span>
  )
}

function Amount({ row }: { row: PlanRow }) {
  if (row.amount === null) {
    return <div className="text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">—<div>bonus {row.bonus! > 0 ? '+' : '−'}{formatCurrency(Math.abs(row.bonus!))}</div></div>
  }
  const credit = row.amount < 0
  return (
    <div className={cn('text-right text-sm font-semibold tabular-nums whitespace-nowrap', credit && 'text-green-600')}>
      {row.amount === 0 ? formatCurrency(0) : `${credit ? '+' : '−'}${formatCurrency(Math.abs(row.amount))}`}
      {row.foreign && <div className="text-[11px] font-normal text-muted-foreground">{row.foreign.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {row.foreign.currency}</div>}
    </div>
  )
}

interface ListProps {
  rows: PlanRow[]
  blockers: string[]
  choices: Record<string, number>
  edits: Record<string, RowEdit>
  categories: Category[]
  problems: { rowKey: string; message: string }[]
  filter: StatusFilter
  onFilter: (f: StatusFilter) => void
  query: string
  onQuery: (q: string) => void
  onChoose: (key: string, index: number) => void
  onOpen: (key: string) => void
  openKey: string | null
  onAcceptRecommended: () => void
}

export function PreviewList(props: ListProps) {
  const { rows, blockers, choices, edits, categories, problems, filter, onFilter, query, onQuery } = props
  const [closed, setClosed] = useState<Record<string, boolean>>({ exists: true, info: true })
  const people = usePeopleStore(st => st.people)
  const personName = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people])

  const catName = useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]))
    return (id?: string) => {
      const parts: string[] = []
      let c = id ? byId.get(id) : undefined
      for (let i = 0; c && i < 4; i++) { parts.unshift(c.name); c = c.parentId ? byId.get(c.parentId) : undefined }
      return parts.join(' › ') || undefined
    }
  }, [categories])

  const problemByKey = useMemo(() => new Map(problems.filter(p => p.message !== 'Karar verilmedi').map(p => [p.rowKey, p.message])), [problems])
  const q = foldText(query)
  const visible = (r: PlanRow) => !q || foldText([r.title, r.raw, r.recipientName ?? '', catName(r.categoryId) ?? '', r.amount !== null ? Math.abs(r.amount).toFixed(2).replace('.', ',') : ''].join(' ')).includes(q)

  const counts: Record<string, number> = { error: blockers.length }
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  const pendingReview = rows.filter(r => r.status === 'review' && (choices[r.key] ?? null) === null).length
  const recommendable = rows.filter(r => r.status === 'review' && choices[r.key] === undefined && r.recommended !== null).length

  const rowView = (r: PlanRow) => {
    const edit = edits[r.key]
    const sel = choices[r.key] ?? r.defaultOption
    const decided = r.status !== 'review' || choices[r.key] !== undefined
    const pickedExisting = edit?.recipientId !== undefined
    const recipient = pickedExisting ? (edit.recipientId ? personName.get(edit.recipientId) : undefined) : (edit?.newRecipient ?? r.recipientName)
    const showNew = !!r.newRecipient && !pickedExisting
    const categoryId = edit?.categoryId ?? r.categoryId
    const problem = problemByKey.get(r.key)
    const tag = KIND_TAG[r.kind]?.(r)
    return (
      <div
        key={r.key}
        role="button" tabIndex={0}
        onClick={() => props.onOpen(r.key)}
        onKeyDown={e => { if (e.key === 'Enter') props.onOpen(r.key) }}
        className={cn(
          'grid grid-cols-[52px_minmax(0,1fr)_auto] md:grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1.3fr)_140px] gap-x-3 gap-y-1.5 items-center px-4 py-2.5 border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/40',
          props.openKey === r.key && 'bg-primary/5',
        )}
      >
        <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{formatDate(r.date, 'd MMM')}</div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{edit?.description ?? r.title}</div>
          <div className="text-[11px] text-muted-foreground/80 truncate tracking-wide">{r.raw}{r.lines.length > 1 ? ` · ${r.lines.length} satır` : ''}</div>
        </div>
        <div className="col-span-3 md:col-span-1 row-start-2 md:row-start-auto flex flex-wrap gap-1.5 min-w-0">
          {r.kind !== 'bonus' && r.kind !== 'payment' && (
            recipient ? <Chip tone={showNew ? 'new' : 'default'}>{showNew ? 'Yeni · ' : ''}{recipient}</Chip> : null
          )}
          {categoryId
            ? <Chip tone={r.categoryGuess && !edit?.categoryId ? 'guess' : 'default'} title={r.categoryGuess ? 'Bu işyerinde kategori değişken; en sık olanı önerildi' : undefined}>
                {catName(categoryId)}{r.categoryGuess && !edit?.categoryId ? ' · tahmin' : ''}
              </Chip>
            : null}
          {tag && <Chip tone="tag">{tag}</Chip>}
          {r.note && <Chip tone="tag">{r.note}</Chip>}
          {r.sideEffects.some(a => a.type === 'patch' && a.patch.approvalStatus === 'approved') && <Chip tone="ok">onaylanacak</Chip>}
          {problem && <Chip tone="bad">{problem}</Chip>}
        </div>
        <div className="row-start-1 col-start-3 md:col-start-4"><Amount row={r} /></div>
        {r.status === 'review' && (
          <div className="col-span-3 md:col-start-2 md:col-span-3 flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
            <span className={cn('text-xs font-semibold', decided ? 'text-muted-foreground' : 'text-amber-600')}>{decided ? '✓ ' : ''}{r.issue}</span>
            {r.options.map((o, i) => (
              <button
                key={o.key} type="button" onClick={() => props.onChoose(r.key, i)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs transition-colors',
                  sel === i && decided ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border hover:bg-muted',
                )}
              >
                {o.label}{!decided && r.recommended === i && <span className="ml-1 text-[10px] font-semibold text-primary">önerilen</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const tabs: [StatusFilter, string, number, string][] = [
    ['all', 'Tümü', rows.length, 'bg-foreground'],
    ...ORDER.map(s => [s, STATUS_META[s].label, s === 'review' ? counts.review ?? 0 : counts[s] ?? 0, STATUS_META[s].dot] as [StatusFilter, string, number, string]),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map(([k, label, c, dot]) => (
          <button key={k} type="button" onClick={() => onFilter(k)}
            className={cn('flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50',
              filter === k ? 'border-foreground' : 'border-border')}>
            <span className={cn('size-2 rounded-full', dot)} />
            <span className="text-sm font-semibold tabular-nums">{c}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>
      <div className="relative">
        <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={query} onChange={e => onQuery(e.target.value)} placeholder="İşyeri, alıcı, kategori ya da tutar ara"
          className="h-9 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {ORDER.filter(s => filter === 'all' || filter === s).map(s => {
        if (s === 'error') {
          return (
            <section key={s} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <span className={cn('size-2 rounded-full', STATUS_META.error.dot)} />
                <h2 className="text-sm font-semibold">Sorun <span className="font-normal text-muted-foreground tabular-nums">{blockers.length}</span></h2>
                <span className="text-xs text-muted-foreground hidden sm:inline">{STATUS_META.error.hint}</span>
              </div>
              {blockers.length
                ? blockers.map(b => <div key={b} className="px-4 py-2.5 text-sm text-destructive border-b border-border/60 last:border-0">{b}</div>)
                : <div className="px-4 py-3 text-xs text-muted-foreground">Sorun yok. Bütün satırlar okundu ve toplam, bankanın dönem borcuyla birebir tuttu.</div>}
            </section>
          )
        }
        const list = rows.filter(r => r.status === s && visible(r))
        if (!list.length && filter === 'all') return null
        const isClosed = filter === 'all' && closed[s]
        const subs = SUBGROUPS[s]
        let body: React.ReactNode
        if (!list.length) body = <div className="px-4 py-3 text-xs text-muted-foreground">Eşleşen satır yok.</div>
        else if (!subs) body = list.map(rowView)
        else {
          const placed = new Set<string>()
          body = subs.map(([label, f]) => {
            const part = list.filter(r => !placed.has(r.key) && f(r))
            part.forEach(r => placed.add(r.key))
            if (!part.length) return null
            const sum = part.reduce((t, r) => t + Math.round((r.amount ?? 0) * 100), 0) / 100
            return (
              <div key={label}>
                <div className="flex justify-between px-4 py-1.5 bg-muted/50 text-[11px] font-semibold text-muted-foreground border-b border-border/60 tabular-nums">
                  <span>{label} {part.length}</span>
                  <span>{sum < 0 ? '+' : '−'}{formatCurrency(Math.abs(sum))}</span>
                </div>
                {part.map(rowView)}
              </div>
            )
          })
        }
        return (
          <section key={s} className="rounded-xl border border-border bg-card overflow-hidden">
            <div
              role="button" tabIndex={0}
              onClick={() => setClosed(c => ({ ...c, [s]: !c[s] }))}
              onKeyDown={e => { if (e.key === 'Enter') setClosed(c => ({ ...c, [s]: !c[s] })) }}
              className={cn('flex items-center gap-2 px-4 py-3 cursor-pointer select-none', !isClosed && 'border-b border-border')}
            >
              <span className={cn('size-2 rounded-full', STATUS_META[s].dot)} />
              <h2 className="text-sm font-semibold">{STATUS_META[s].label} <span className="font-normal text-muted-foreground tabular-nums">{list.length}</span></h2>
              <span className="text-xs text-muted-foreground flex-1 hidden sm:inline">{STATUS_META[s].hint}</span>
              <span className="flex-1 sm:hidden" />
              {s === 'review' && pendingReview > 0 && recommendable > 0 && (
                <Button size="sm" variant="outline" className="rounded-lg" onClick={e => { e.stopPropagation(); props.onAcceptRecommended() }}>
                  Önerilenleri uygula ({recommendable})
                </Button>
              )}
              <IconChevronDown className={cn('size-4 text-muted-foreground transition-transform', isClosed && '-rotate-90')} />
            </div>
            {!isClosed && body}
          </section>
        )
      })}
    </div>
  )
}
