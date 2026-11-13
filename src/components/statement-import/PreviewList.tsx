'use client'

import { useMemo } from 'react'
import { IconAlertTriangle, IconChevronRight, IconSearch } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { CategoryIcon } from '@/components/categories/CategoryIcon'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date'
import { foldText } from '@/lib/auto-category'
import { usePeopleStore } from '@/store'
import type { Category, Person } from '@/types'
import { optionDisplayOrder, type PlanRow, type RowKind, type RowStatus } from '@/lib/statement-import/classify'
import { chosenIndex, rowTitle, selectedOption, type RowChoices, type RowEdit } from '@/lib/statement-import/commit'
import { RefundLinkPicker, refundLinkSelection } from './RefundLinkPicker'

/* ── Önizleme listesi ────────────────────────────────────────────────────────
   Hiyerarşi: (Sorun) → Kontrol et → Girilecek → Zaten sistemde → Kayda girmez.
   Dikkat isteyenler açık ve en üstte; sorunsuzlar kapalı başlar. Satır sade:
   ad, altında tek gri satırda alıcı ve kategori (kendi ikonlarıyla), sağda
   tutar. Bankanın ham metni adın üzerine gelince görünür. Karar gereken
   satırın seçenekleri bitişik bir düğme grubudur. */

export const STATUS_META: Record<'error' | RowStatus, { label: string; dot: string; hint: string }> = {
  error:  { label: 'Sorun',          dot: 'bg-destructive',       hint: 'Bunlar çözülmeden kayıt yapılmaz.' },
  review: { label: 'Kontrol et',     dot: 'bg-orange-600',        hint: 'Her biri için bir seçim yapın' },
  new:    { label: 'Girilecek',      dot: 'bg-green-600',         hint: 'Geçmiş kayıtlarınızdan öğrenilen alıcı ve kategoriyle' },
  exists: { label: 'Zaten sistemde', dot: 'bg-muted-foreground/60', hint: 'Tekrar girilmeyecek' },
  info:   { label: 'Kayda girmez',   dot: 'bg-sky-500',           hint: 'Bonus, hesap içi aktarım ve takip dışı hareketler' },
}

const ORDER: RowStatus[] = ['review', 'new', 'exists', 'info']

const SUBGROUPS: Partial<Record<RowStatus, [string, (r: PlanRow) => boolean][]>> = {
  new: [
    ['Harcamalar', r => r.kind === 'purchase'],
    ['Yeni taksitli alımlar', r => r.kind === 'installment-new'],
    ['Faiz ve ücretler', r => r.kind === 'fee'],
    ['Gelirler', r => r.kind === 'income'],
    ['Faiz ve stopaj', r => r.kind === 'interest' || r.kind === 'tax'],
    ['Transferler ve kart ödemeleri', r => r.kind === 'transfer-out' || r.kind === 'transfer-in'],
    ['Diğer', () => true],
  ],
  exists: [
    ['Tek çekim ve iadeler', r => r.kind === 'purchase' || r.kind === 'refund' || r.kind === 'fee'],
    ['Taksitler', r => r.kind === 'installment' || r.kind === 'lump'],
    ['Açılış bakiyesindeki taksitler', r => r.kind === 'opening'],
    ['Ödemeler', r => r.kind === 'payment'],
    ['Önceki kararla girilmeyenler', () => true],
  ],
}

const KIND_TAG: Partial<Record<RowKind, (r: PlanRow) => string>> = {
  'installment-new': r => `${r.installment!.count} taksit`,
  'installment-missing': r => `Taksit ${r.installment!.index}/${r.installment!.count}`,
  installment: r => (r.installment ? `Taksit ${r.installment.index}/${r.installment.count}` : 'Taksit'),
  opening: r => `Taksit ${r.installment!.index}/${r.installment!.count} · açılış bakiyesinde`,
  lump: r => `Taksit ${r.installment!.index}/${r.installment!.count} · tek kayıt`,
  'amount-diff': r => `Taksit ${r.installment!.index}/${r.installment!.count}`,
  fee: () => 'Faiz/ücret',
  payment: () => 'Kart ödemesi',
  internal: () => 'Hesap içi',
  investment: () => 'Yatırım',
}

const sumMinor = (list: PlanRow[]) => list.reduce((t, r) => t + Math.round((r.amount ?? 0) * 100), 0) / 100

/** Kart ekstresinde harcama olağan durumdur: harcama düz, alacak yeşil "+". */
function Amount({ row, quiet }: { row: PlanRow; quiet?: boolean }) {
  if (row.amount === null) {
    return <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">bonus {row.bonus! > 0 ? '+' : '−'}{formatCurrency(Math.abs(row.bonus!))}</span>
  }
  const credit = row.amount < 0
  return (
    <div className="text-right whitespace-nowrap">
      <div className={cn('text-sm tabular-nums', quiet ? 'font-medium text-muted-foreground' : 'font-semibold', credit && 'text-green-600')}>
        {credit ? '+' : ''}{formatCurrency(Math.abs(row.amount))}
      </div>
      {row.foreign && <div className="text-[11px] text-muted-foreground tabular-nums">{row.foreign.amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {row.foreign.currency}</div>}
    </div>
  )
}

const Dot = () => <span className="text-muted-foreground/50">·</span>

interface ListProps {
  rows: PlanRow[]
  blockers: string[]
  choices: RowChoices
  edits: Record<string, RowEdit>
  categories: Category[]
  problems: { rowKey: string; message: string }[]
  query: string
  onQuery: (q: string) => void
  onChoose: (key: string, index: number) => void
  onOpen: (key: string) => void
  openKey: string | null
  onAcceptRecommended: () => void
  /** Satırın düzenlemesi (iade satırında bağlanacak alımın seçimi) */
  onEdit: (key: string, patch: RowEdit) => void
  /** Kapalı bölümler (ilerleme listesinden atlarken açılabilsin diye yukarıda tutulur) */
  closed: Record<string, boolean>
  onToggleSection: (s: RowStatus, open?: boolean) => void
  /** Kısa süre vurgulanan satır (ilerleme listesinden gelindi) */
  highlightKey: string | null
}

export function PreviewList(props: ListProps) {
  const { rows, blockers, choices, edits, categories, problems, query, onQuery } = props
  const closed = props.closed
  const people = usePeopleStore(st => st.people)
  const personById = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  const catPath = (id?: string) => {
    const parts: string[] = []
    let c = id ? catById.get(id) : undefined
    for (let i = 0; c && i < 4; i++) { parts.unshift(c.name); c = c.parentId ? catById.get(c.parentId) : undefined }
    return parts.join(' › ') || undefined
  }

  const problemByKey = useMemo(() => new Map(problems.filter(p => p.message !== 'Karar verilmedi').map(p => [p.rowKey, p.message])), [problems])
  const q = foldText(query)
  const visible = (r: PlanRow) => !q || foldText([r.title, r.raw, r.recipientName ?? '', catPath(r.categoryId) ?? '', r.amount !== null ? Math.abs(r.amount).toFixed(2).replace('.', ',') : ''].join(' ')).includes(q)

  const byStatus = (s: RowStatus) => rows.filter(r => r.status === s)
  const pendingReview = rows.filter(r => r.status === 'review' && chosenIndex(r, choices) === null).length
  const recommendable = rows.filter(r => r.status === 'review' && chosenIndex(r, choices) === null && r.recommended !== null).length

  function jump(s: RowStatus) {
    props.onToggleSection(s, true)
    requestAnimationFrame(() => document.getElementById(`stmt-sec-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  // ── Alt satır: alıcı (avatar) · kategori (ikon) · etiket ──
  const metaLine = (r: PlanRow) => {
    const edit = edits[r.key]
    const bits: React.ReactNode[] = []
    if (r.kind !== 'bonus' && r.kind !== 'payment' && r.kind !== 'transfer-in' && r.kind !== 'transfer-out') {
      const pickedExisting = edit?.recipientId !== undefined
      const person: Person | undefined = pickedExisting
        ? (edit.recipientId ? personById.get(edit.recipientId) : undefined)
        : (r.recipientId ? personById.get(r.recipientId) : undefined)
      const newName = !pickedExisting && r.newRecipient ? (edit?.newRecipient ?? r.recipientName) : undefined
      if (person) {
        bits.push(<span key="p" className="inline-flex items-center gap-1.5 min-w-0"><PersonAvatar person={person} size="xs" /><span className="truncate">{person.name}</span></span>)
      } else if (newName) {
        bits.push(
          <span key="p" className="inline-flex items-center gap-1.5 min-w-0 text-primary font-medium">
            <PersonAvatar person={{ name: newName, role: 'recipient' }} size="xs" />
            <span className="truncate">Yeni: {newName}</span>
          </span>,
        )
      }
      const cat = catById.get(edit?.categoryId ?? r.categoryId ?? '')
      if (cat) {
        const guess = r.categoryGuess && !edit?.categoryId
        bits.push(
          <span key="c" className="inline-flex items-center gap-1.5 min-w-0" title={guess ? `${catPath(cat.id)} — tahmin; gerekçesi satırın ayrıntısında` : catPath(cat.id)}>
            <CategoryIcon icon={cat.icon} color={cat.color} size={10} />
            <span className={cn('truncate', guess && 'border-b border-dashed border-muted-foreground/60')}>{cat.name}</span>
          </span>,
        )
      }
    }
    const tag = KIND_TAG[r.kind]?.(r)
    if (tag) bits.push(<span key="t" className="whitespace-nowrap">{tag}</span>)
    if (r.note) bits.push(<span key="n" className="whitespace-nowrap">{r.note}</span>)
    if (r.sideEffects.some(a => a.type === 'patch' && a.patch.approvalStatus === 'approved')) bits.push(<span key="a" className="text-green-600 whitespace-nowrap">onaylanacak</span>)
    if (!bits.length) return <span className="truncate text-muted-foreground/70">{r.raw}</span>
    return bits.flatMap((b, i) => (i ? [<Dot key={`d${i}`} />, b] : [b]))
  }

  // ── Karar: konu + bitişik seçenek grubu ──
  const decision = (r: PlanRow) => {
    const sel = chosenIndex(r, choices)
    const decided = sel !== null
    return (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5" onClick={e => e.stopPropagation()}>
        <span className={cn('text-xs font-semibold', decided ? 'text-muted-foreground' : 'text-orange-600')}>{decided ? '✓ ' : ''}{r.issue}</span>
        <div className="inline-flex flex-wrap rounded-lg border border-border bg-muted/40 overflow-hidden">
          {optionDisplayOrder(r.options).map(i => { const o = r.options[i]; return (
            <button
              key={o.key} type="button" onClick={() => props.onChoose(r.key, i)}
              className={cn('px-2.5 py-1 text-xs border-l border-border first:border-l-0 transition-colors',
                sel === i ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
              title={!decided && r.recommended === i ? 'Önerilen' : undefined}
            >
              {o.label}
              {!decided && r.recommended === i && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle" aria-label="önerilen" />}
            </button>
          ) })}
        </div>
      </div>
    )
  }

  const rowView = (r: PlanRow) => {
    const edit = edits[r.key]
    const quiet = r.status === 'exists' || r.status === 'info'
    return (
      <div
        key={r.key}
        id={`stmt-row-${r.key}`}
        role="button" tabIndex={0}
        onClick={() => props.onOpen(r.key)}
        onKeyDown={e => { if (e.key === 'Enter') props.onOpen(r.key) }}
        className={cn(
          'grid grid-cols-[48px_minmax(0,1fr)_auto] sm:grid-cols-[56px_minmax(0,1fr)_auto] gap-x-3 sm:gap-x-4 px-4 py-2.5 border-t border-border/60 first:border-t-0 cursor-pointer hover:bg-muted/40',
          props.openKey === r.key && 'bg-primary/5',
          props.highlightKey === r.key && 'bg-primary/10 ring-2 ring-inset ring-primary/60',
          'scroll-mt-24 transition-colors',
        )}
      >
        <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap pt-0.5">{formatDate(r.date, 'd MMM')}</div>
        <div className="min-w-0">
          <div className={cn('text-sm truncate', quiet ? 'text-foreground/80' : 'font-medium')} title={r.raw}>
            {rowTitle(r, choices, edit)}{r.lines.length > 1 && <span className="text-muted-foreground font-normal"> · {r.lines.length} satır</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 overflow-hidden whitespace-nowrap">{metaLine(r)}</div>
        </div>
        <Amount row={r} quiet={quiet} />
        {r.status === 'review' && <div className="col-start-2 col-span-2 mt-2">{decision(r)}</div>}
        {r.refundLink && r.options[selectedOption(r, choices) ?? -1]?.key === 'link' && (
          <div className="col-start-2 col-span-2 mt-2 min-w-0">
            <RefundLinkPicker row={r} selectedId={refundLinkSelection(r, choices, edit)} onPick={patch => props.onEdit(r.key, patch)} />
          </div>
        )}
        {problemByKey.has(r.key) && (
          <div className="col-start-2 col-span-2 mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
            <IconAlertTriangle className="size-3.5 flex-shrink-0" />{problemByKey.get(r.key)} — düzeltmek için tıklayın
          </div>
        )}
      </div>
    )
  }

  const pills: [RowStatus, string, number][] = [
    ['review', 'Kontrol et', pendingReview],
    ['new', 'Girilecek', byStatus('new').length],
    ['exists', 'Zaten sistemde', byStatus('exists').length],
    ['info', 'Kayda girmez', byStatus('info').length],
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {pills.filter(([s]) => byStatus(s).length > 0).map(([s, label, n]) => (
          <button key={s} type="button" onClick={() => jump(s)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
            <span className={cn('size-2 rounded-full', STATUS_META[s].dot)} />
            <span className="text-sm font-semibold text-foreground tabular-nums">{s === 'review' && n === 0 ? '✓' : n}</span>{label}
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

      {blockers.length > 0 && (
        <section className="rounded-xl border border-destructive/40 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <span className={cn('size-2 rounded-full', STATUS_META.error.dot)} />
            <h2 className="text-sm font-semibold">Sorun <span className="font-normal text-muted-foreground tabular-nums">{blockers.length}</span></h2>
            <span className="text-xs text-muted-foreground hidden sm:inline">{STATUS_META.error.hint}</span>
          </div>
          {blockers.map(b => <div key={b} className="px-4 py-2.5 text-sm text-destructive border-t border-border/60 first:border-t-0">{b}</div>)}
        </section>
      )}

      {ORDER.map(s => {
        const all = byStatus(s)
        const list = all.filter(visible)
        if (!list.length) return null
        const isClosed = !!closed[s] && !q
        const subs = SUBGROUPS[s]
        let body: React.ReactNode
        if (!subs) body = list.map(rowView)
        else {
          const placed = new Set<string>()
          body = subs.map(([label, f]) => {
            const part = list.filter(r => !placed.has(r.key) && f(r))
            part.forEach(r => placed.add(r.key))
            if (!part.length) return null
            const sum = sumMinor(part)
            return (
              <div key={label}>
                <div className="flex justify-between px-4 py-1.5 bg-muted/50 text-[11px] font-semibold text-muted-foreground tabular-nums">
                  <span>{label} <span className="font-normal">{part.length}</span></span>
                  <span>{sum < 0 ? '+' : ''}{formatCurrency(Math.abs(sum))}</span>
                </div>
                {part.map(rowView)}
              </div>
            )
          })
        }
        const sum = sumMinor(list)
        return (
          <section key={s} id={`stmt-sec-${s}`} className="rounded-xl border border-border bg-card overflow-hidden scroll-mt-20">
            <div
              role="button" tabIndex={0}
              onClick={() => props.onToggleSection(s)}
              onKeyDown={e => { if (e.key === 'Enter') props.onToggleSection(s) }}
              className="flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none"
            >
              <span className={cn('size-2 rounded-full flex-shrink-0', STATUS_META[s].dot)} />
              <h2 className="text-[15px] font-semibold whitespace-nowrap">
                {STATUS_META[s].label}{' '}
                <span className="font-normal text-muted-foreground tabular-nums">{s === 'review' && pendingReview ? `${pendingReview}/${list.length}` : list.length}</span>
              </h2>
              <span className="text-xs text-muted-foreground/80 hidden md:inline truncate">{STATUS_META[s].hint}</span>
              {(() => { const n = list.filter(r => problemByKey.has(r.key)).length; return n > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive whitespace-nowrap">{n} eksik</span>
              ) })()}
              <span className="flex-1" />
              {s === 'review' && recommendable > 0
                ? (
                  <Button size="sm" variant="outline" className="rounded-lg" onClick={e => { e.stopPropagation(); props.onAcceptRecommended() }}>
                    Önerilenleri uygula
                  </Button>
                )
                : s === 'new' && <span className="text-sm text-muted-foreground tabular-nums">{sum < 0 ? '+' : ''}{formatCurrency(Math.abs(sum))}</span>}
              <IconChevronRight className={cn('size-4 text-muted-foreground transition-transform flex-shrink-0', !isClosed && 'rotate-90')} />
            </div>
            {!isClosed && <div className="border-t border-border">{body}</div>}
          </section>
        )
      })}
    </div>
  )
}
