'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTransactionStore } from '@/store'
import { TransactionList } from '@/components/transactions/TransactionList'
import { BatchEditDrawer } from '@/components/transactions/BatchEditDrawer'
import { useTxSelection } from '@/lib/hooks/useTxSelection'
import { SelectField } from '@/components/ui/Select'
import { formatCurrency } from '@/lib/utils/currency'
import { tagKey, tagColor, normalizeTag } from '@/lib/utils/tags'
import { sumByType, isFlowTx } from '@/lib/utils/calculations'
import { collapseInstallments } from '@/lib/utils/installments'

interface Props { tag: string }

export default function TagDetailClient({ tag }: Props) {
  const router       = useRouter()
  const transactions = useTransactionStore(s => s.transactions)
  const txsReady     = useTransactionStore(s => s.ready)
  const renameTag    = useTransactionStore(s => s.renameTag)

  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [editing,    setEditing]    = useState(false)
  const [draft,      setDraft]      = useState('')
  // Toplu düzenleme seçimi — filtre değişince temizlenir
  const sel = useTxSelection(`${search}|${typeFilter}`)

  const key = tagKey(tag)

  // All transactions carrying this tag (case-insensitive).
  const tagTxs = useMemo(
    () => transactions.filter(t => t.tags?.some(x => tagKey(x) === key)),
    [transactions, key],
  )

  // Canonical display casing = most frequent among matching transactions;
  // falls back to the URL value when nothing matches (stale link).
  const displayTag = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tagTxs) {
      for (const x of t.tags ?? []) {
        if (tagKey(x) === key) counts.set(x.trim(), (counts.get(x.trim()) ?? 0) + 1)
      }
    }
    let best = tag.trim(), bestN = -1
    for (const [casing, n] of counts) if (n > bestN) { bestN = n; best = casing }
    return best
  }, [tagTxs, key, tag])

  const filteredTxs = useMemo(
    () => tagTxs.filter(t => {
      if (typeFilter && t.type !== typeFilter) return false
      if (search && !t.description.toLowerCase().includes(search.toLowerCase())) return false
      return true
    }),
    [tagTxs, typeFilter, search],
  )

  // Başlıktaki Gelir/Gider + İşlem sayısı AYNI akış kuralıyla (isFlowTx) hesaplanır:
  // onay bekleyen/gelecek, mutabakat ghost'u ve yatırım anaparası hariç — böylece
  // etiket LİSTESİ (aggregateTags, mutabakatı zaten dışlar) ile detay sayfası aynı
  // gelir/gideri verir, ve sayaç toplamla aynı kümeden gelir. ₺ (baz PB) TRY-normalize.
  // collapseInstallments: taksitli alışverişler Raporlar ile aynı "satın alma
  // ayına toplu yaz" kuralıyla sayılır — LİSTE (`tagTxs`/`filteredTxs`, ham)
  // buna dahil değil, kullanıcı gerçek defter satırlarını görmeye devam eder.
  const flowTagTxs = useMemo(
    () => collapseInstallments(transactions)
      .filter(t => t.tags?.some(x => tagKey(x) === key) && isFlowTx(t)),
    [transactions, key],
  )
  const { income: totalIncome, expense: totalExpense } = sumByType(flowTagTxs)

  const color = tagColor(key)

  function startEdit() {
    setDraft(displayTag)
    setEditing(true)
  }
  async function commitEdit() {
    const next = normalizeTag(draft)
    setEditing(false)
    if (!next || next === displayTag) return
    await renameTag(displayTag, next)
    // Etiket taşındı — key değişmişse bu URL boş kalır; yeni etikete yönlendir.
    if (tagKey(next) !== key) router.replace(`/tags/${encodeURIComponent(next)}`)
  }

  // Wait for the store before deciding a tag has no transactions.
  if (!txsReady) return null

  return (
    <div className="flex flex-col h-full">
      {/* Back header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background sticky top-0 z-30 flex-shrink-0">
        <button
          onClick={() => router.push('/tags')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Etiketler
        </button>
      </div>

      {/* Tag summary */}
      <div className="px-6 py-5 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="size-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
            style={{ background: `${color}1A`, color }}
          >
            #
          </span>
          {editing ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit()
                  else if (e.key === 'Escape') setEditing(false)
                }}
                className="flex-1 min-w-0 text-base font-semibold bg-background px-3 py-1.5 rounded-lg border border-border outline-none focus:border-primary text-foreground"
              />
              <button
                type="button"
                onClick={commitEdit}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex-shrink-0"
              >
                Kaydet
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
              >
                İptal
              </button>
            </div>
          ) : (
            <>
              <div className="min-w-0">
                <div className="text-base font-semibold text-foreground truncate">{displayTag}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Etiket</div>
              </div>
              <button
                type="button"
                onClick={startEdit}
                aria-label="Etiketi düzenle"
                title="Etiketi düzenle"
                className="ml-auto flex-shrink-0 size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={17} height={17}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="flex gap-6 pt-4 border-t border-border">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gelir</div>
            <div className="text-sm font-medium tabular-nums text-green-600">+{formatCurrency(totalIncome)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">Gider</div>
            <div className="text-sm font-medium tabular-nums text-destructive">−{formatCurrency(totalExpense)}</div>
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">İşlem</div>
            <div className="text-sm font-medium tabular-nums text-foreground">{flowTagTxs.length}</div>
          </div>
        </div>
      </div>

      {/* Search + type filter */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border flex-shrink-0">
        <input
          type="text"
          placeholder="İşlem ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-32 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
        />
        <SelectField
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: '',         label: 'Tüm Türler' },
            { value: 'expense',  label: 'Gider' },
            { value: 'income',   label: 'Gelir' },
            { value: 'transfer', label: 'Transfer' },
          ]}
          className="w-fit bg-card text-xs"
        />
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-auto">
        <TransactionList
          transactions={filteredTxs}
          layout="table"
          showAccount
          emptyTitle="İşlem bulunamadı"
          emptyDescription={
            tagTxs.length === 0
              ? `"${displayTag}" etiketli işlem yok. Bu etiket artık kullanılmıyor olabilir.`
              : 'Filtreyle eşleşen işlem yok.'
          }
          selectable
          selectedIds={sel.selectedIds}
          onToggleSelect={sel.toggle}
          onSelectMany={sel.selectMany}
        />
      </div>

      <BatchEditDrawer selectedIds={sel.list} onClose={sel.clear} />
    </div>
  )
}
