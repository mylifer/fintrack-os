'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePeopleStore, useTransactionStore } from '@/store'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField } from '@/components/ui/Select'
import { formatCurrency } from '@/lib/utils/currency'
import {
  BOARDS, enrichPeople, makePersonMatcher, sortPeople, SORT_LABELS,
  type BoardVariant, type SortId,
} from './shared'
import { PersonEditModal } from './PersonEditModal'
import { TableView } from './views/TableView'
import { IndexView } from './views/IndexView'
import type { Person } from '@/types'

/* ── Kişi tahtası (Alıcılar / Aile Üyeleri) ──────────────────────────────────
 * Kabuk her şeyi tutar: arama, sıralama, ekleme/düzenleme/arşivleme ve
 * toplamların hesabı. Görünümler yalnız basar. Dolayısıyla görünüm değiştirmek
 * satır kümesini ya da tutarları DEĞİŞTİRMEZ — ikisi aynı veriyi gösterir.
 *
 * Toplamlar isFlowTx ile süzülür (Dashboard/Raporlar/kişi detayı ile aynı akış
 * kuralı) ve TRY-normalize + kuruş-exact toplanır; akış dışı bağlı satırlar
 * "+N bekleyen" olarak ayrıca görünür, sessizce yok sayılmaz.
 *
 * İki sayfanın tek farkı `variant` (bkz. BOARDS): hangi işlem alanına
 * bağlandığı, para kolonları ve etiketler.
 * ------------------------------------------------------------------------- */
const VIEWS = [
  { id: 'table', label: 'Tablo', Comp: TableView, hint: 'Yoğun, kıyaslamalı tablo' },
  { id: 'index', label: 'Dizin', Comp: IndexView, hint: 'A–Z harf grupları, çok kompakt' },
] as const

type ViewId = typeof VIEWS[number]['id']

export function PeopleBoard({ variant }: { variant: BoardVariant }) {
  const config = BOARDS[variant]

  const allPeople     = usePeopleStore(s => s.people)
  const loadPeople    = usePeopleStore(s => s.load)
  const removePerson  = usePeopleStore(s => s.remove)
  const restorePerson = usePeopleStore(s => s.restore)
  const transactions  = useTransactionStore(s => s.transactions)

  useEffect(() => { loadPeople() }, [loadPeople])

  const [view,   setView]   = useState<ViewId>('table')
  const [query,  setQuery]  = useState('')
  const [sort,   setSort]   = useState<SortId>(config.sorts[0])
  const [adding, setAdding] = useState(false)
  const [editing,  setEditing]  = useState<Person | null>(null)
  const [archiving, setArchiving] = useState<Person | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active   = useMemo(
    () => allPeople.filter(p => p.role === config.role && !p.isArchived),
    [allPeople, config.role],
  )
  const archived = useMemo(
    () => allPeople.filter(p => p.role === config.role && p.isArchived),
    [allPeople, config.role],
  )

  // Paylar (share) TÜM aktif kişiler üzerinden hesaplanır; arama sonradan
  // süzer. Böylece arama yapmak "%pay" değerlerini oynatmaz.
  const allRows = useMemo(
    () => enrichPeople(active, transactions, config.link),
    [active, transactions, config.link],
  )

  const rows = useMemo(() => {
    const matches = allRows.filter(makePersonMatcher(query))
    return sortPeople(matches, sort)
  }, [allRows, query, sort])

  const shownExpense = rows.reduce((s, r) => s + r.expense, 0)
  const shownIncome  = rows.reduce((s, r) => s + r.income, 0)
  const Active = (VIEWS.find(v => v.id === view) ?? VIEWS[0]).Comp

  async function confirmArchive() {
    if (!archiving) return
    await removePerson(archiving.id)   // arşivler (silmez) + geri alma kaydı bırakır
    setArchiving(null)
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-[1400px] mx-auto">

          {/* ── Araç çubuğu: arama + sıralama + görünüm + ekle ─────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-52">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70 pointer-events-none"
                width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2} strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
                placeholder={config.labels.searchPlaceholder}
                aria-label={config.labels.searchAria}
                className="w-full h-9 pl-9 pr-9 rounded-xl border border-input bg-background dark:bg-muted text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Aramayı temizle"
                  className="absolute right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  ✕
                </button>
              )}
            </div>

            <SelectField
              value={sort}
              onChange={e => setSort(e.target.value as SortId)}
              options={config.sorts.map(id => ({ value: id, label: `Sırala: ${SORT_LABELS[id]}` }))}
              className="w-fit bg-card text-xs"
            />

            {/* Görünüm seçici (segmented control) */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  title={v.hint}
                  aria-pressed={view === v.id}
                  className={`px-3 h-7 rounded-lg text-xs font-semibold transition-colors ${
                    view === v.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <Button size="sm" onClick={() => setAdding(true)}>{config.labels.addButton}</Button>
          </div>

          {/* ── Sayaç şeridi ──────────────────────────────────────────────── */}
          {active.length > 0 && (
            <div className="flex items-baseline gap-3 mb-3 px-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {query ? `${rows.length} / ${active.length}` : active.length} {config.labels.countNoun}
              </span>
              {/* Aile üyesinde gelir de anlamlı; alıcıda yalnız gider yönü var. */}
              {config.role === 'family_member' && shownIncome > 0 && (
                <span className="tabular-nums">
                  toplam gelir {formatCurrency(shownIncome)}
                </span>
              )}
              {shownExpense > 0 && (
                <span className="tabular-nums">
                  toplam gider {formatCurrency(shownExpense)}
                </span>
              )}
            </div>
          )}

          {/* ── Liste ─────────────────────────────────────────────────────── */}
          {active.length === 0 ? (
            <EmptyState
              icon="👤"
              title={config.labels.emptyTitle}
              description={config.labels.emptyDescription}
              action={<Button size="sm" onClick={() => setAdding(true)}>{config.labels.emptyAction}</Button>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="🔍"
              title={config.labels.noMatchTitle}
              description={`"${query}" aramasıyla eşleşen bir kayıt bulunamadı.`}
              action={<Button variant="ghost" size="sm" onClick={() => setQuery('')}>Aramayı temizle</Button>}
            />
          ) : (
            <Active
              rows={rows}
              config={config}
              query={query}
              sort={sort}
              onSort={setSort}
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          )}

          {/* ── Arşivlenenler — bağlı işlemler adı çözmeye devam ettiği için
                 kayıt silinmez, gizlenir. ─────────────────────────────────── */}
          {archived.length > 0 && (
            <div className="mt-8">
              <button
                onClick={() => setShowArchived(v => !v)}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className={`text-[10px] transition-transform ${showArchived ? 'rotate-90' : ''}`}>▶</span>
                Arşivlenenler ({archived.length})
              </button>

              {showArchived && (
                <div className="mt-3 rounded-xl border border-border/60 bg-card overflow-hidden">
                  {archived.map(person => (
                    <div
                      key={person.id}
                      className="flex items-center gap-3 px-4 h-11 border-b border-border/40 last:border-0 opacity-70"
                    >
                      <PersonAvatar person={person} size="sm" />
                      <Link
                        href={`${config.basePath}/${person.id}`}
                        className="flex-1 min-w-0 text-sm font-medium text-foreground/70 truncate hover:text-primary transition-colors"
                      >
                        {person.name}
                      </Link>
                      <Button variant="ghost" size="sm" onClick={() => restorePerson(person.id)}>
                        Geri Al
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {adding && <PersonEditModal config={config} onClose={() => setAdding(false)} />}
      {editing && (
        <PersonEditModal
          key={editing.id}
          config={config}
          person={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {archiving && (
        <Modal open onClose={() => setArchiving(null)} title={config.labels.archiveTitle} size="sm">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{archiving.name}</span> listeden kaldırılsın mı?
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Bağlı işlemlere dokunulmaz — adları görünmeye devam eder. Arşivden her
            zaman geri alabilirsiniz.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5">
            <Button variant="ghost" size="sm" onClick={() => setArchiving(null)}>İptal</Button>
            <Button variant="danger" size="sm" onClick={confirmArchive}>Arşivle</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
