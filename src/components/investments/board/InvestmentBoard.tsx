'use client'

import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { SelectField } from '@/components/ui/Select'
import { BuySellModal } from '@/components/investments/BuySellModal'
import { useAccountStore, useInvestmentStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { matchesTokens, tokenize } from '@/lib/utils/boardText'
import { tefasCodesIn } from '@/lib/tefas'
import { useInvestmentsView } from '@/components/layout/InvestmentsViewProvider'
import { INVESTMENTS_VIEWS } from '@/lib/investments-view'
import { TransactionTable } from './TransactionTable'
import { PriceTicker } from './PriceTicker'
import {
  SORT_LABELS, assetMeta, buildRows, fmtPct, pnlColor,
  type SortId,
} from './shared'
import { ClassicView }    from './views/ClassicView'
import { ConsoleView }    from './views/ConsoleView'
import { GroupedView }    from './views/GroupedView'
import { AllocationView } from './views/AllocationView'
import { FocusView }      from './views/FocusView'
import type { InvestmentTransaction } from '@/types'

/* ── Yatırım tahtası ─────────────────────────────────────────────────────────
 * Liste sayfalarının tahta kalıbı (board-pages-pattern) buraya taşındı: kabuk
 * her şeyi tutar — fiyat şeridi, özet, arama, sıralama, görünüm seçici, al/sat,
 * işlem geçmişi — görünümler saf sunumdur. GÖRÜNÜM DEĞİŞTİRMEK satır kümesini
 * ya da tutarları DEĞİŞTİRMEZ; yalnız sunum ve kırılım değişir.
 *
 * Görünüm tercihi ÇEREZDE (lib/investments-view.ts) ve sunucudan gelir; buradaki
 * segment seçici ile Ayarlar > Yatırım Görünümü kartı aynı değeri yazar.
 *
 * Beş görünüm (varsayılan Klasik):
 *   Klasik   — eski düzen: özet kartları + varlık başına grafik ızgarası + tablo
 *   Konsol   — tek yoğun tablo, satır içi eğri, satır açılınca grafik
 *   Sınıf    — birleşik portföy grafiği + sınıfa göre gruplu tablo, ara toplamlar
 *   Dağılım  — kompozisyon (yığılı çubuk) ana kahraman, sınıfa inilebilir
 *   Odak     — varlık rayı + seçili varlığın grafiği, künyesi ve işlemleri
 * ------------------------------------------------------------------------- */

const SORTS: SortId[] = ['value', 'pnl', 'pnlPct', 'day', 'cost', 'name']

export function InvestmentBoard() {
  const load              = useInvestmentStore(s => s.load)
  const transactions      = useInvestmentStore(s => s.transactions)
  const prices            = useInvestmentStore(s => s.prices)
  const pricesLoading     = useInvestmentStore(s => s.pricesLoading)
  const pricesError       = useInvestmentStore(s => s.pricesError)
  const fetchPrices       = useInvestmentStore(s => s.fetchPrices)
  const fundPrices        = useInvestmentStore(s => s.fundPrices)
  const fundPricesError   = useInvestmentStore(s => s.fundPricesError)
  const getHoldings       = useInvestmentStore(s => s.getHoldings)
  const removeTransaction = useInvestmentStore(s => s.removeTransaction)
  const accounts          = useAccountStore(useShallow(s => s.accounts))

  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState<'buy' | 'sell'>('buy')
  const [editingTx, setEditingTx] = useState<InvestmentTransaction | null>(null)

  const [query, setQuery] = useState('')
  const [sort,  setSort]  = useState<SortId>('value')

  // Görünüm tercihi tek kaynaktan gelir: çerez → kök layout → sağlayıcı.
  // Buradaki segment seçici ile Ayarlar'daki kart AYNI değeri yazar.
  const { view, setView } = useInvestmentsView()

  useEffect(() => {
    load()
    fetchPrices()
    const id = setInterval(fetchPrices, 60 * 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const holdings = getHoldings()

  // Fon şeridi yalnız AKTİF alanın fonlarını göstersin — fundPrices kod bazlı
  // tek sözlük ve alan değiştikçe birikiyor.
  const wsFundCodes = useMemo(
    () => new Set(tefasCodesIn(transactions.map(t => t.asset))),
    [transactions],
  )

  const allRows = useMemo(
    () => buildRows(holdings, transactions, prices, fundPrices),
    [holdings, transactions, prices, fundPrices],
  )

  // Arama satırları SÜZER, tutarları değiştirmez: özet şeridi hep tüm portföyü
  // gösterir (aksi halde "toplam" aramaya göre oynardı).
  const tokens = tokenize(query)
  const rows = useMemo(
    () => (tokens.length
      ? allRows.filter(r => matchesTokens(`${r.meta.label} ${r.meta.subLabel ?? ''}`, tokens))
      : allRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, query],
  )

  const totalValue = allRows.reduce((s, r) => s + r.currentValue, 0)
  const totalCost  = allRows.reduce((s, r) => s + r.totalCost, 0)
  const totalPnl   = totalValue - totalCost
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

  // Günlük değişim: yalnızca önceki kapanışı BİLİNEN varlıklardan toplanır;
  // bilinmeyenler 0 sayılmaz, tutar eksik kalmasın diye ayrıca sayılır.
  const dayKnown  = allRows.filter(r => r.dayValue !== null)
  const dayValue  = dayKnown.reduce((s, r) => s + (r.dayValue ?? 0), 0)
  const dayBase   = dayKnown.reduce((s, r) => s + (r.currentValue - (r.dayValue ?? 0)), 0)
  const dayPct    = dayBase > 0 ? (dayValue / dayBase) * 100 : null
  const dayMissing = allRows.length - dayKnown.length

  const visibleTxs = useMemo(() => {
    if (!tokens.length) return transactions
    const keep = new Set(rows.map(r => r.asset))
    return transactions.filter(t => keep.has(t.asset)
      || matchesTokens(assetMeta(t.asset, fundPrices).label, tokens)
      || matchesTokens(t.note ?? '', tokens))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, rows, query, fundPrices])

  function openBuy()  { setEditingTx(null); setModalType('buy');  setModalOpen(true) }
  function openSell() { setEditingTx(null); setModalType('sell'); setModalOpen(true) }
  function openEdit(tx: InvestmentTransaction) { setEditingTx(tx); setModalOpen(true) }

  const activeView = INVESTMENTS_VIEWS.find(v => v.key === view)!
  const hasPortfolio = allRows.length > 0 || totalCost > 0

  return (
    <>
      <Header title="Yatırımlar" action={{ label: 'İşlem Ekle', onClick: openBuy }} />

      <PriceTicker
        prices={prices}
        fundPrices={fundPrices}
        wsFundCodes={wsFundCodes}
        loading={pricesLoading}
        error={pricesError ?? fundPricesError}
        onRefresh={fetchPrices}
      />

      <div className="p-6 flex flex-col gap-5 overflow-auto flex-1">

        {/* ── Özet şeridi ───────────────────────────────────────────
            Dört kart yerine tek şerit: aynı sayılar, dört kat az dikey alan —
            grafik/tablo ekranın üstünde kalsın. */}
        {hasPortfolio && view !== 'classic' && (
          <div className="rounded-xl border border-border/60 bg-card px-5 py-3.5 flex flex-wrap items-center gap-x-8 gap-y-3">
            <SumItem label="Toplam Değer" value={formatCurrency(totalValue)} strong />
            <SumItem label="Maliyet"      value={formatCurrency(totalCost)} />
            <SumItem
              label="Kar / Zarar"
              value={(totalPnl >= 0 ? '+' : '−') + formatCurrency(Math.abs(totalPnl))}
              className={pnlColor(totalPnl)}
            />
            <SumItem
              label="K/Z %"
              value={fmtPct(totalPnlPct)}
              className={pnlColor(totalPnl)}
            />
            <SumItem
              label="Bugün"
              value={dayPct === null ? '—' : `${(dayValue >= 0 ? '+' : '−')}${formatCurrency(Math.abs(dayValue))} · ${fmtPct(dayPct)}`}
              className={dayPct === null ? 'text-muted-foreground' : pnlColor(dayValue)}
              note={dayMissing > 0 ? `${dayMissing} varlıkta önceki kapanış yok` : undefined}
            />
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
              {allRows.length} varlık · {transactions.length} işlem
            </span>
          </div>
        )}

        {/* ── Araç çubuğu ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-[300px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">⌕</span>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
              placeholder="Varlık ara…"
              aria-label="Varlık ara"
              className="w-full h-9 pl-9 pr-9 rounded-xl border border-input bg-background dark:bg-muted text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Aramayı temizle"
                className="absolute right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >✕</button>
            )}
          </div>

          <SelectField
            value={sort}
            onChange={e => setSort(e.target.value as SortId)}
            options={SORTS.map(id => ({ value: id, label: `Sırala: ${SORT_LABELS[id]}` }))}
            className="w-fit bg-card text-xs"
          />

          {/* Görünüm seçici */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60">
            {INVESTMENTS_VIEWS.map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                title={v.hint}
                aria-pressed={view === v.key}
                className={`px-3 h-7 rounded-lg text-xs font-semibold transition-colors ${
                  view === v.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >{v.label}</button>
            ))}
          </div>

          <div className="flex gap-2 ml-auto">
            <button
              onClick={openBuy}
              className="px-3 h-9 rounded-xl bg-green-600 text-white text-xs font-semibold hover:bg-green-600/80 transition-colors"
            >Al</button>
            <button
              onClick={openSell}
              className="px-3 h-9 rounded-xl bg-destructive text-white text-xs font-semibold hover:bg-destructive/80 transition-colors"
            >Sat</button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground -mt-2 px-1">
          {activeView.hint}
          {query && ` · ${rows.length}/${allRows.length} varlık eşleşti`}
        </p>

        {/* ── Görünüm ───────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card px-5 py-12 text-center text-sm text-muted-foreground">
            {query ? 'Aramaya uyan varlık yok.' : 'Portföyde varlık yok. Yatırım işlemi ekleyin.'}
          </div>
        ) : view === 'classic' ? (
          <ClassicView
            rows={rows} transactions={transactions}
            prices={prices} fundPrices={fundPrices} sort={sort}
            totalValue={totalValue} totalCost={totalCost}
            onBuy={openBuy} onSell={openSell}
          />
        ) : view === 'console' ? (
          <ConsoleView rows={rows} transactions={transactions} query={query} sort={sort} onSort={setSort} />
        ) : view === 'grouped' ? (
          <GroupedView
            rows={rows} transactions={transactions} query={query} sort={sort} onSort={setSort}
            totalValue={totalValue} totalCost={totalCost}
          />
        ) : view === 'alloc' ? (
          <AllocationView
            rows={rows} transactions={transactions} query={query} sort={sort} onSort={setSort}
            totalValue={totalValue}
          />
        ) : (
          <FocusView
            rows={rows} transactions={transactions} fundPrices={fundPrices} accounts={accounts}
            query={query} sort={sort}
            onEditTx={openEdit}
            onDeleteTx={removeTransaction}
          />
        )}

        {/* ── İşlem geçmişi ─────────────────────────────────────────
            Odak görünümü işlemleri kendi sağ panelinde varlık bazında
            gösteriyor; aynı listeyi altta ikinci kez basmıyoruz. */}
        {view !== 'focus' && (
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <div className="px-5 h-11 flex items-center border-b border-border/60">
              <span className="text-sm font-semibold text-foreground/90">İşlem Geçmişi</span>
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {visibleTxs.length} işlem
              </span>
            </div>
            <TransactionTable
              transactions={visibleTxs}
              fundPrices={fundPrices}
              accounts={accounts}
              onEdit={openEdit}
              onDelete={removeTransaction}
            />
          </div>
        )}
      </div>

      <BuySellModal
        open={modalOpen}
        defaultType={modalType}
        editingTx={editingTx}
        onClose={() => { setModalOpen(false); setEditingTx(null) }}
      />
    </>
  )
}

function SumItem({ label, value, className = '', strong = false, note }: {
  label: string; value: string; className?: string; strong?: boolean; note?: string
}) {
  return (
    <div title={note}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground block">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-lg font-medium' : 'text-sm font-medium'} ${className || 'text-foreground'}`}>
        {value}
      </span>
      {note && <span className="block text-[9px] text-sky-500/90">{note}</span>}
    </div>
  )
}
