'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { CategoryCascadeSelect } from '@/components/categories/CategoryCascadeSelect'
import { formatCurrency, getCurrencySymbol, parseCurrencyInput } from '@/lib/utils/currency'
import { setSplitAmount, type DraftSplit } from '@/lib/utils/categorySplits'
import { toMinor } from '@/lib/utils/money'
import { cn } from '@/lib/utils'
import type { Category, CurrencyCode } from '@/types'

/* ────────────────────────────────────────────────────────────────────────
   Kategori bölme — oran barı

   İşlem tutarı kategoriler arasında paylaştırılır. Barın değişmezi: paylar
   toplamı HER ZAMAN işlem tutarına eşittir.

   Tutarını YAZDIĞIN pay sabitlenir ve bir daha kendiliğinden değişmez; kalan
   tutar otomatik payların arasında paylaşılır, pratikte sonuncusu kalanı yutar
   (setSplitAmount). Tutamaç sürüklemek yalnızca iki komşu pay arasında para
   taşır ve ikisini de sabitler. Bu yüzden "eksik/fazla" hata durumu bu alanda
   oluşamaz — tek doğrulama, her satırın kategorisinin seçilmiş olmasıdır.
──────────────────────────────────────────────────────────────────────── */

// Tutar alanları sağa hizalı bir kolon oluşturur → kuruş hanesi kaymasın diye
// değer HER ZAMAN iki ondalıkla yazılır (yalnızca odaktaki alan ham kalır).
function fmtAmount(v: number): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false,
  }).format(v)
}

// Ana tutar alanıyla aynı giriş kuralı: sadece rakam ve TEK virgül.
function sanitize(input: string): string {
  const cleaned = input.replace(/[^0-9,]/g, '')
  const first = cleaned.indexOf(',')
  return first === -1
    ? cleaned
    : cleaned.slice(0, first + 1) + cleaned.slice(first + 1).replace(/,/g, '')
}

interface Props {
  splits: DraftSplit[]
  onChange: (splits: DraftSplit[]) => void
  /** İşlem tutarının BÜYÜKLÜĞÜ (işaret taşımaz). */
  total: number
  currency: CurrencyCode
  categories: Category[]
  onCreateCategory: (name: string) => Promise<string | null>
  onAdd: () => void
  onRemove: (index: number) => void
  onReset: () => void
  error?: string
}

export function CategorySplitField({
  splits, onChange, total, currency, categories, onCreateCategory, onAdd, onRemove, onReset, error,
}: Props) {
  // Yazarken odaktaki alanın ham metni burada yaşar; diğer satırlar her zaman
  // biçimlenmiş değeri gösterir (odak kaybı ve imleç zıplaması olmasın diye).
  const [draft, setDraft] = useState<{ index: number; value: string } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const catById = (id: string) => categories.find(c => c.id === id)
  const safeTotal = total > 0 ? total : 0
  const pct = (v: number) => (safeTotal > 0 ? (Math.abs(v) / safeTotal) * 100 : 100 / splits.length)

  function commit(index: number, nextAmount: number) {
    onChange(setSplitAmount(splits, index, nextAmount, safeTotal))
  }

  // Tutamaç sürükleme: yalnızca i ve i+1 payları arasında para taşır, toplam sabit.
  function startDrag(e: React.PointerEvent, i: number) {
    const bar = barRef.current
    if (!bar || safeTotal <= 0) return
    e.preventDefault()
    const width = bar.getBoundingClientRect().width
    const startX = e.clientX
    const pairMinor = toMinor(splits[i].amount) + toMinor(splits[i + 1].amount)
    const startMinor = toMinor(splits[i].amount)
    const totalMinor = toMinor(safeTotal)

    const move = (ev: PointerEvent) => {
      const deltaMinor = Math.round(((ev.clientX - startX) / width) * totalMinor)
      const mine = Math.max(0, Math.min(pairMinor, startMinor + deltaMinor))
      // Sürükleme de elle bir karardır → iki pay da sabitlenir.
      const next = splits.map(s => ({ ...s }))
      next[i]     = { ...next[i],     amount: mine / 100,               pinned: true }
      next[i + 1] = { ...next[i + 1], amount: (pairMinor - mine) / 100, pinned: true }
      onChange(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Klavye erişimi: tutamaç ok tuşlarıyla %1 adımlarla oynar.
  function nudge(i: number, dir: -1 | 1) {
    const stepMinor = Math.max(1, Math.round(toMinor(safeTotal) / 100))
    const pairMinor = toMinor(splits[i].amount) + toMinor(splits[i + 1].amount)
    const mine = Math.max(0, Math.min(pairMinor, toMinor(splits[i].amount) + dir * stepMinor))
    const next = splits.map(s => ({ ...s }))
    next[i].amount = mine / 100
    next[i + 1].amount = (pairMinor - mine) / 100
    onChange(next)
  }

  // Paylarda seçili kategoriler — her satırın seçicisi bunları devre dışı
  // gösterir (kendi seçimi hariç, bkz. CategoryCascadeSelect.disabledIds).
  const usedIds = new Set(splits.map(s => s.categoryId).filter(Boolean))
  const canAdd = splits.length < 8 && categories.some(c => !usedIds.has(c.id) && !c.isArchived)
  const hasPinned = splits.some(s => s.pinned)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {hasPinned
            ? 'Girdiğin tutarlar sabit — kalan otomatik paya yazılır'
            : 'Payları sürükleyerek veya tutar yazarak ayarla'}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {hasPinned && (
            <button type="button" onClick={onReset} className="text-xs font-medium text-primary hover:underline">
              Eşit böl
            </button>
          )}
          <span className="text-xs font-medium tabular-nums text-[var(--cf-income)]">
            Toplam {formatCurrency(safeTotal, currency)}
          </span>
        </span>
      </div>

      {/* Oran barı */}
      <div
        ref={barRef}
        className="flex h-9 overflow-hidden rounded-md border border-input select-none"
      >
        {splits.map((s, i) => {
          const c = catById(s.categoryId)
          const share = pct(s.amount)
          return (
            <div
              key={`${s.categoryId || 'empty'}-${i}`}
              className="relative grid min-w-0 place-items-center overflow-hidden text-[11px] font-semibold text-white"
              style={{ flex: `0 0 ${share}%`, background: c?.color ?? 'var(--muted-foreground)' }}
            >
              {share > 11 && (
                <span style={{ textShadow: '0 1px 2px rgba(0,0,0,.35)' }}>{Math.round(share)}%</span>
              )}
              {i < splits.length - 1 && (
                <button
                  type="button"
                  onPointerDown={e => startDrag(e, i)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowLeft')  { e.preventDefault(); nudge(i, -1) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(i,  1) }
                  }}
                  aria-label={`${c?.name ?? 'Kategori'} payını ayarla`}
                  className="absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="pointer-events-none absolute inset-y-1.5 left-1 w-0.5 rounded-full bg-white/75" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Satırlar — kolon genişlikleri sabit, tutar alanları tek hizada */}
      <div className="flex flex-col gap-1.5">
        {splits.map((s, i) => (
          <div
            key={`row-${i}`}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: 'minmax(0,1fr) 34px 104px 12px 24px' }}
          >
            <CategoryCascadeSelect
              categories={categories}
              value={s.categoryId}
              onChange={id => onChange(splits.map((x, j) => j === i ? { ...x, categoryId: id } : x))}
              error={!s.categoryId}
              onCreate={onCreateCategory}
              // Aynı kategori iki paya giremez. Kural kategorinin KENDİSİNE
              // özeldir: üst kategori bir payda kullanılsa da alt kategorileri
              // (ve tersi) seçilebilir kalır.
              disabledIds={usedIds}
            />
            <span className="text-right text-[11px] tabular-nums text-muted-foreground">
              {Math.round(pct(s.amount))}%
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={draft?.index === i ? draft.value : fmtAmount(s.amount)}
              onChange={e => {
                const v = sanitize(e.target.value)
                const typed = parseCurrencyInput(v)
                // Toplamı aşan giriş kırpılır. Alanın GÖSTERDİĞİ değer de
                // kırpılır: aksi halde satır 1.250 olurken kutuda "900625,00"
                // yazıyor gibi görünüyordu (gerçekte uygulanmayan bir değer).
                const clamped = Math.min(typed, safeTotal)
                setDraft({ index: i, value: typed > safeTotal ? fmtAmount(clamped) : v })
                commit(i, clamped)
              }}
              onFocus={e => setDraft({ index: i, value: e.target.value })}
              onBlur={() => setDraft(null)}
              aria-label={`${catById(s.categoryId)?.name ?? `${i + 1}. kategori`} tutarı`}
              // Otomatik pay: değeri kalandan hesaplanıyor → kesikli kenar ve
              // soluk mürekkep, sabitlenmiş paylardan ayrılsın diye.
              title={s.pinned ? undefined : 'Kalan tutardan otomatik hesaplanır'}
              className={cn(
                'h-8 w-full rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none',
                'focus:border-ring focus:ring-2 focus:ring-ring/50 dark:bg-muted',
                hasPinned && !s.pinned
                  ? 'border-dashed border-border text-muted-foreground'
                  : 'border-input',
              )}
            />
            <span className="text-xs text-muted-foreground">{getCurrencySymbol(currency)}</span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`${catById(s.categoryId)?.name ?? `${i + 1}. kategori`} payını kaldır`}
              className="justify-self-center rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        {canAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Kategori ekle
          </button>
        ) : <span />}
        {error && <span className={cn('text-xs text-destructive')}>{error}</span>}
      </div>
    </div>
  )
}
