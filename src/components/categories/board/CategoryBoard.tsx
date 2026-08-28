'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useCategoryStore, useTransactionStore } from '@/store'
import { useUndoStore } from '@/store/undo.store'
import { CategoryIcon } from '../CategoryIcon'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField } from '@/components/ui/Select'
import { formatCurrency } from '@/lib/utils/currency'
import { compareCategoriesByName } from '@/lib/utils/categories'
import {
  enrichCategories, makeCategoryMatcher, sortCategories,
  SCOPE_LABELS, SORTS, SORT_LABELS, type SortId,
} from './shared'
import { CategoryEditModal } from './CategoryEditModal'
import { TableView } from './views/TableView'
import { IndexView } from './views/IndexView'
import type { Category, CategoryScope } from '@/types'

/* ── Kategoriler ─────────────────────────────────────────────────────────────
 * Alıcılar/Aile Üyeleri tahtasıyla aynı kalıp: kabuk her şeyi tutar (kapsam,
 * arama, sıralama, ekle/düzenle/arşivle ve toplamların hesabı), görünümler
 * yalnız basar. Görünüm değiştirmek satır kümesini ya da tutarları DEĞİŞTİRMEZ.
 *
 * Toplamlar isFlowTx ile süzülür ve alt ağacı kapsar (kategori detay başlığıyla
 * aynı kural); bölünmüş işlemler paylarına açılır. Akış dışı bağlı satırlar
 * "+N bekleyen" olarak ayrıca görünür, sessizce yok sayılmaz.
 * ------------------------------------------------------------------------- */
const VIEWS = [
  { id: 'table', label: 'Tablo', Comp: TableView, hint: 'Yoğun, kıyaslamalı tablo' },
  { id: 'index', label: 'Dizin', Comp: IndexView, hint: 'A–Z harf grupları, çok kompakt' },
] as const

type ViewId = typeof VIEWS[number]['id']
const STORAGE_KEY = 'categories.viewMode'

export function CategoryBoard() {
  const categories   = useCategoryStore(s => s.categories)
  const remove       = useCategoryStore(s => s.remove)
  const restore      = useCategoryStore(s => s.restore)
  const transactions = useTransactionStore(s => s.transactions)

  const [scope, setScope] = useState<CategoryScope>('expense')
  // Görünüm tercihi kalıcı (SSR'da 'table'a düşer) — eski kabuğun anahtarı korunuyor.
  const [view, setView] = useState<ViewId>(() => {
    if (typeof window === 'undefined') return 'table'
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return VIEWS.some(v => v.id === saved) ? (saved as ViewId) : 'table'
  })
  const [query,  setQuery]  = useState('')
  const [sort,   setSort]   = useState<SortId>('total')
  const [adding, setAdding] = useState(false)
  const [editing,   setEditing]   = useState<Category | null>(null)
  const [archiving, setArchiving] = useState<Category | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  function pickView(id: ViewId) {
    setView(id)
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* özel pencere: yoksay */ }
  }

  // Paylar TÜM aktif kategoriler üzerinden hesaplanır; arama sonradan süzer.
  // Böylece arama yapmak "%pay" değerlerini oynatmaz.
  const allRows = useMemo(
    () => enrichCategories(categories, transactions, scope),
    [categories, transactions, scope],
  )

  const rows = useMemo(() => {
    const matches = allRows.filter(makeCategoryMatcher(query))
    return sortCategories(matches, sort)
  }, [allRows, query, sort])

  // Kapsam toplamı yalnız KÖK satırlardan toplanır — alt kategoriler zaten
  // köklerinin içinde sayılıyor, iki kez eklenmemeli.
  const scopeTotal = allRows.reduce((s, r) => s + (r.level === 0 ? r.magnitude : 0), 0)

  const archived = useMemo(
    () => categories.filter(c => c.scope === scope && c.isArchived).sort(compareCategoriesByName),
    [categories, scope],
  )

  const rootCount = (s: CategoryScope) =>
    categories.filter(c => c.scope === s && !c.parentId && !c.isArchived).length

  const childrenOfAll = (id: string) => categories.filter(c => c.parentId === id)
  const subtreeIds = (id: string): string[] =>
    [id, ...childrenOfAll(id).flatMap(c => subtreeIds(c.id))]

  /** Arşivleme alt ağacın tamamına iner: yoksa alt kategoriler öksüz kalırdı.
   *  Tek geri-alma kaydı bırakılır, o da tüm alt ağacı geri getirir. */
  async function confirmArchive() {
    if (!archiving) return
    const ids = subtreeIds(archiving.id).reverse()   // yapraklardan köke
    for (const id of ids) await remove(id, { undoable: false })
    useUndoStore.getState().pushUndo(
      ids.length > 1 ? `Kategori ve ${ids.length - 1} alt kategorisi arşivlendi` : 'Kategori arşivlendi',
      async () => { for (const id of ids) await restore(id) },
    )
    setArchiving(null)
  }

  async function restoreSubtree(cat: Category) {
    for (const id of subtreeIds(cat.id)) await restore(id)
  }

  const archivingChildren = archiving ? subtreeIds(archiving.id).length - 1 : 0
  const Active = (VIEWS.find(v => v.id === view) ?? VIEWS[0]).Comp

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-[1400px] mx-auto">

          {/* ── Araç çubuğu: kapsam + arama + sıralama + görünüm + ekle ────── */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Kapsam sekmeleri — gider ve gelir ayrı ağaçlar */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60">
              {(['expense', 'income'] as CategoryScope[]).map(s => (
                <button
                  key={s}
                  onClick={() => { setScope(s); setQuery('') }}
                  aria-pressed={scope === s}
                  className={`flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-semibold transition-colors ${
                    scope === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {SCOPE_LABELS[s]}
                  <span className="text-[10px] tabular-nums text-muted-foreground">{rootCount(s)}</span>
                </button>
              ))}
            </div>

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
                placeholder="Kategori ara…"
                aria-label="Kategori ara"
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
              options={SORTS.map(id => ({ value: id, label: `Sırala: ${SORT_LABELS[id]}` }))}
              className="w-fit bg-card text-xs"
            />

            {/* Görünüm seçici (segmented control) */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  onClick={() => pickView(v.id)}
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

            <Button size="sm" onClick={() => setAdding(true)}>+ Yeni Kategori</Button>
          </div>

          {/* ── Sayaç şeridi ──────────────────────────────────────────────── */}
          {allRows.length > 0 && (
            <div className="flex items-baseline gap-3 mb-3 px-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {query ? `${rows.length} / ${allRows.length}` : allRows.length} kategori
              </span>
              {scopeTotal > 0 && (
                <span className="tabular-nums">
                  toplam {SCOPE_LABELS[scope].toLocaleLowerCase('tr-TR')} {formatCurrency(scopeTotal)}
                </span>
              )}
              {sort !== 'name' && (
                <span className="hidden sm:inline">
                  alt kategoriler ayrı satır — tutarları üstlerinin içinde de sayılır
                </span>
              )}
            </div>
          )}

          {/* ── Liste ─────────────────────────────────────────────────────── */}
          {allRows.length === 0 ? (
            <EmptyState
              icon="🏷️"
              title={`Henüz ${SCOPE_LABELS[scope].toLocaleLowerCase('tr-TR')} kategorisi yok`}
              description="Kategori ekleyerek işlemlerinizi gruplayabilir, bütçe ve raporlarda takip edebilirsiniz."
              action={<Button size="sm" onClick={() => setAdding(true)}>Kategori Ekle</Button>}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Eşleşen kategori yok"
              description={`"${query}" aramasıyla eşleşen bir kategori bulunamadı.`}
              action={<Button variant="ghost" size="sm" onClick={() => setQuery('')}>Aramayı temizle</Button>}
            />
          ) : (
            <Active
              rows={rows}
              query={query}
              sort={sort}
              onSort={setSort}
              onEdit={setEditing}
              onArchive={setArchiving}
            />
          )}

          {/* ── Arşivlenenler — bağlı işlemler kategoriyi çözmeye devam ettiği
                 için kayıt silinmez, gizlenir. ────────────────────────────── */}
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
                  {archived.map(cat => {
                    const parent = cat.parentId ? categories.find(c => c.id === cat.parentId) : undefined
                    return (
                      <div
                        key={cat.id}
                        className="flex items-center gap-3 px-4 h-11 border-b border-border/40 last:border-0 opacity-70"
                      >
                        <CategoryIcon icon={cat.icon} color={cat.color} size={14} />
                        <Link
                          href={`/categories/${cat.id}`}
                          className="flex-1 min-w-0 text-sm font-medium text-foreground/70 truncate hover:text-primary transition-colors"
                        >
                          {parent && <span className="text-xs text-muted-foreground/70">{parent.name} › </span>}
                          {cat.name}
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => restoreSubtree(cat)}>
                          Geri Al
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {adding && (
        <CategoryEditModal scope={scope} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <CategoryEditModal
          key={editing.id}
          scope={scope}
          category={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {archiving && (
        <Modal open onClose={() => setArchiving(null)} title="Kategoriyi arşivle" size="sm">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{archiving.name}</span> listeden kaldırılsın mı?
          </p>
          {archivingChildren > 0 && (
            <p className="text-xs font-medium text-destructive mt-2">
              {archivingChildren} alt kategorisi de birlikte arşivlenecek.
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Bağlı işlemlere dokunulmaz — kategori adları görünmeye devam eder.
            Arşivden her zaman geri alabilirsiniz.
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
