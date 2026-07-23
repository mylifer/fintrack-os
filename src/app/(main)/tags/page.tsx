'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTags } from '@/lib/hooks/useTags'
import { useTransactionStore } from '@/store'
import { formatCurrency } from '@/lib/utils/currency'
import { tagColor, tagKey, normalizeTag } from '@/lib/utils/tags'

export default function TagsPage() {
  const tags       = useTags()
  const txsReady   = useTransactionStore(s => s.ready)
  const renameTag  = useTransactionStore(s => s.renameTag)
  const [search, setSearch] = useState('')

  // Satır-içi yeniden adlandırma durumu: düzenlenen etiketin key'i + taslak metin.
  const [editKey, setEditKey] = useState<string | null>(null)
  const [draft,   setDraft]   = useState('')

  const filtered = useMemo(() => {
    const q = tagKey(search)
    return q ? tags.filter(t => t.key.includes(q)) : tags
  }, [tags, search])

  function startEdit(tag: string, key: string) {
    setEditKey(key)
    setDraft(tag)
  }
  function cancelEdit() {
    setEditKey(null)
    setDraft('')
  }
  async function commitEdit(oldTag: string) {
    const next = normalizeTag(draft)
    cancelEdit()
    // Boşsa veya hiç değişmediyse (aynı casing dahil) dokunma.
    if (!next || next === oldTag) return
    await renameTag(oldTag, next)
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Etiketler" />
      <div className="flex-1 overflow-hidden p-4 lg:p-6">
        <div className="h-full rounded-2xl border border-border bg-card overflow-hidden flex flex-col">

          {/* Search */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
            <input
              type="text"
              placeholder="Etiket ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-32 text-sm bg-background px-4 py-2 rounded-xl border border-transparent focus:border-border outline-none placeholder:text-muted-foreground/60 text-foreground"
            />
            {tags.length > 0 && (
              <span className="text-xs text-muted-foreground flex-shrink-0">{tags.length} etiket</span>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon="#"
                title={!txsReady ? 'Yükleniyor…' : search ? 'Etiket bulunamadı' : 'Henüz etiket yok'}
                description={
                  search
                    ? 'Aramanızla eşleşen etiket yok.'
                    : 'İşlem eklerken etiket atadığınızda burada görünür.'
                }
              />
            ) : (
              <div className="flex flex-col divide-y divide-border/60">
                {filtered.map(t => (
                  editKey === t.key ? (
                    <div
                      key={t.key}
                      className="flex items-center gap-3 px-5 py-3 bg-accent/40"
                    >
                      <span
                        className="size-8 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-bold"
                        style={{ background: `${tagColor(t.key)}1A`, color: tagColor(t.key) }}
                      >
                        #
                      </span>
                      <input
                        type="text"
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(t.tag)
                          else if (e.key === 'Escape') cancelEdit()
                        }}
                        className="flex-1 min-w-0 text-sm bg-background px-3 py-1.5 rounded-lg border border-border outline-none focus:border-primary text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => commitEdit(t.tag)}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity flex-shrink-0"
                      >
                        Kaydet
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                      >
                        İptal
                      </button>
                    </div>
                  ) : (
                    <div
                      key={t.key}
                      className="group flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors"
                    >
                      <Link
                        href={`/tags/${encodeURIComponent(t.tag)}`}
                        className="flex items-center gap-3 flex-1 min-w-0"
                      >
                        <span
                          className="size-8 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-bold"
                          style={{ background: `${tagColor(t.key)}1A`, color: tagColor(t.key) }}
                        >
                          #
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {t.tag}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.count} işlem
                          </div>
                        </div>
                      </Link>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-semibold tabular-nums text-foreground">
                          {formatCurrency(t.volume)}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {t.expense > 0 && <span className="text-destructive">−{formatCurrency(t.expense)}</span>}
                          {t.expense > 0 && t.income > 0 && <span className="opacity-40"> · </span>}
                          {t.income > 0 && <span className="text-green-600">+{formatCurrency(t.income)}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEdit(t.tag, t.key)}
                        aria-label="Etiketi düzenle"
                        title="Etiketi düzenle"
                        className="flex-shrink-0 size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      >
                        <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" width={16} height={16}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
